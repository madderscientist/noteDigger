/// <reference path="../ui/channelDiv.js" />

/**
 * 管理用户在钢琴卷帘上的动作
 * @param {App} parent 
 */
function _MidiAction(parent) {
    this.clickX = 0;    // 绝对坐标 单位像素
    this.clickYid = 0;  // 离散坐标 单位离散格

    this.mode = 0;      // 0: 笔模式 1: 选择模式
    this.frameMode = 0; // 0: 框选 1: 列选 2: 行选
    this.frameXid = -1; // 框选的终点的X序号(Y序号=this.Keyboard.highlight-24) 此变量便于绘制 如果是负数则不绘制

    this.alphaIntensity = true; // 绘制音符时是否根据音量使用透明度

    this.snapMode = 1;   // 0: 不吸附 1: 吸附到网格线 -1: 吸附到小节线
    /**
     * 根据snapMode吸附x坐标到不同的位置
     * @param {number} x x是全局位置 单位:像素
     * @returns [l, r] 除以 parent.width 后是相对于谱面起点的坐标，和最短的下一个位置
     */
    this.snapRound = (x) => {
        // 最短为一个像素
        if (this.snapMode == 0) return [x / parent._width, (x + 1) / parent._width];
        // 最短一格
        if (this.snapMode == 1) {
            let i = x / parent._width | 0;
            return [i, i + 1];
        }
        // 小节吸附
        const m = parent.BeatBar.beats.getMeasure(Math.max(0, x * parent.TperP), true);
        const start = m.start * parent.PperT;
        const Interval = m.interval * parent.PperT;
        const dp = Interval / m.beatNum;
        // 没有细分
        if (dp < parent.BeatBar.minInterval) return [start, start + Interval];
        // 细分 和_BeatBar.render的逻辑一致
        const noteNum = 1 << Math.log2(dp / parent.BeatBar.minInterval);
        const subDp = dp / noteNum;
        const n = ((x - start) / subDp | 0) * subDp + start;
        return [n / parent._width, (n + subDp) / parent._width];
    };

    /* 一个音符 = {
        y: 离散 和spectrum的y一致
        x1: 离散 起点
        x2: 离散 终点
        ch: 音轨序号
        selected: 是否选中
        v: 音量，0~127，用户创建的音符无此选项，但导入的midi有 需要undefined兼容
    } */
    this.selected = []; // 选中的音符 无序即可
    this.midi = [];     // 所有音符 需要维护有序性

    var _anyAction = false; // 用于在选中多个后判断松开鼠标时应该如何处理选中

    if (!parent.synthesizer) throw new Error('MidiAction requires a synthesizer to be created.');
    const cd = this.channelDiv = new ChannelList(document.getElementById('funcSider'), parent.synthesizer);
    // 导入midi时创建音轨不应该update，而是应该在音符全创建完成后存档
    cd.updateCount = -1;    // -1表示需要update 否则表示禁用更新但记录了请求次数
    cd.switchUpdateMode = (state, forceUpdate = false, type = 0b11) => { // 控制音轨的更新
        if (state) {    // 切换回使能update
            if (cd.updateCount > 0 || forceUpdate) {    // 如果期间有更新请求
                this.updateView();
                parent.snapshot.save(type);
            } cd.updateCount = -1;
        } else if (cd.updateCount < 0) {    // 如果是从true切换为false
            cd.updateCount = 0;
        }
    }
    const updateOnReorder = () => {
        if (cd.updateCount < 0) {
            this.updateView();
            parent.snapshot.save(0b11);
        } else cd.updateCount++;
    };
    /**
     * 触发add和remove后也可能会触发reorder，取决于增删的是否是最后一项（见channelDiv.js）
     * 故不是总能触发reorder的更新存档功能updateOnReorder
     * 而更新与存档必须在reorder之后，因为reorder会重新映射channel
     * 为了避免重复存档，需要暂时屏蔽reorder的存档功能
     * 等到reorder之后一定会发生的added和removed事件触发后再恢复
     */
    const resumeReroderCallback = () => {
        updateOnReorder();  // 稳定触发
        cd.addEventListener('reorder', updateOnReorder);
    };

    cd.addEventListener('reorder', ({ detail }) => {
        for (const nt of this.midi) nt.ch = detail[nt.ch];
    }); // 重新映射音符 更新视图在updateOnReorder中
    cd.addEventListener('reorder', updateOnReorder);

    cd.addEventListener('remove', ({ detail }) => {
        this.midi = this.midi.filter((nt) => nt.ch != detail.index);
        this.selected = this.selected.filter((nt) => nt.ch != detail.index);
        cd.removeEventListener('reorder', updateOnReorder);
    });
    cd.addEventListener('removed', resumeReroderCallback);

    cd.addEventListener('add', () => {
        cd.removeEventListener('reorder', updateOnReorder);
    });
    cd.addEventListener('added', resumeReroderCallback);

    const saveOnStateChange = () => {
        parent.snapshot.save(0b1);
    }
    cd.container.addEventListener('lock', ({ target }) => {
        this.selected = this.selected.filter((nt) => {
            if (nt.ch == target.index) return nt.selected = false;
            return true;
        });
    });
    cd.container.addEventListener('lock', saveOnStateChange);
    // cd.container.addEventListener('visible', saveOnStateChange);    // visible会联动lock，因此无需存档
    cd.container.addEventListener('mute', saveOnStateChange);
    cd.addEventListener('setted', saveOnStateChange);

    this.insight = [];  // 二维数组，每个元素为一个音轨视野内的音符 音符拾取依赖此数组
    /**
     * 更新this.MidiAction.insight
     * 步骤繁琐，不必每次更新。触发时机:
     * 1. channelDiv的reorder、added、removed，实际为updateOnReorder和switchUpdateMode
     * 2. midi的增加、移动、改变长度（用户操作）。由于都会调用且最后调用changeNoteY，所以只需要在changeNoteY中调用
     * 3. scroll2
     * 4. midi的删除（用户操作）：deleteNote
     * 5. ctrlZ、ctrlY、ctrlV
     */
    this.updateView = () => {
        const m = this.midi;
        const channel = Array.from(this.channelDiv.channel, () => []);
        this.insight = channel;
        // 原来用的二分有bug，所以干脆全部遍历
        for (const nt of m) {
            if (nt.x1 >= parent.idXend) break;
            if (nt.x2 < parent.idXstart) continue;
            if (nt.y < parent.idYstart || nt.y >= parent.idYend) continue;
            channel[nt.ch].push(nt);
        }
        // midi模式下，视野要比音符宽一页，或超出视野半页
        if (parent.midiMode) {
            const currentLen = parent.Spectrogram.spectrogram.length;
            const apage = parent.layers.width / parent._width;
            let minLen = (m.length ? m[m.length - 1].x2 : 0) + apage * 1.5 | 0;
            let viewLen = parent.idXstart + apage | 0;    // 如果视野在很外面，需要保持视野
            if (viewLen > minLen) minLen = viewLen;
            if (minLen != currentLen) parent.Spectrogram.spectrogram.length = minLen;   // length触发audio.duration和this.xnum
        }
        parent.layers.action.dirty = true;
    };
    this.render = () => {     // 按照insight绘制音符
        const m = this.insight;
        const s = parent.layers.action.ctx;
        const c = this.channelDiv.channel;
        for (let ch = m.length - 1; ch >= 0; ch--) {
            if (m[ch].length === 0 || !c[ch].visible) continue;
            let ntcolor = c[ch].color;
            if (c[ch].lock) s.setLineDash([5, 5]);
            for (const note of m[ch]) {
                const params = [note.x1 * parent._width - parent.scrollX, parent.layers.height - note.y * parent._height + parent.scrollY, (note.x2 - note.x1) * parent._width, -parent._height];
                if (note.selected) {
                    s.fillStyle = '#ffffff';
                    s.fillRect(...params);
                    s.strokeStyle = ntcolor;
                    s.strokeRect(...params);
                } else {
                    if (this.alphaIntensity && note.v) {
                        s.fillStyle = ntcolor + Math.round(note.v ** 2 * 0.01581).toString(16);   // 平方律显示强度
                    } else s.fillStyle = ntcolor;
                    s.fillRect(...params);
                    s.strokeStyle = '#ffffff';
                    s.strokeRect(...params);
                }
            }
            s.setLineDash([]);
        } if (!this.mode || this.frameXid < 0) return;
        // 绘制框选动作
        s.fillStyle = '#f0f0f088';
        const clickXid = this.clickX / parent._width | 0;
        let [xmin, xmax] = clickXid <= this.frameXid ? [clickXid, this.frameXid + 1] : [this.frameXid, clickXid + 1];
        const Y = parent.Keyboard.highlight - 24;
        let [ymin, ymax] = Y <= this.clickYid ? [Y, this.clickYid + 1] : [this.clickYid, Y + 1];
        let x1, x2, y1, y2;
        if (this.frameMode == 1) {  // 列选
            x1 = xmin * parent._width - parent.scrollX;
            x2 = (xmax - xmin) * parent._width;
            y1 = 0;
            y2 = parent.layers.height;
        } else if (this.frameMode == 2) {   // 行选
            x1 = 0;
            x2 = parent.layers.width;
            y1 = parent.layers.height - ymax * parent._height + parent.scrollY;
            y2 = (ymax - ymin) * parent._height;
        } else {    // 框选
            x1 = xmin * parent._width - parent.scrollX;
            x2 = (xmax - xmin) * parent._width;
            y1 = parent.layers.height - ymax * parent._height + parent.scrollY;
            y2 = (ymax - ymin) * parent._height;
        } s.fillRect(x1, y1, x2, y2);
    };
    /**
     * 删除选中的音符 触发updateView
     * @param {boolean} save 是否存档
     */
    this.deleteNote = (save = true) => {
        this.selected.forEach((v) => {
            let i = this.midi.indexOf(v);
            if (i != -1) this.midi.splice(i, 1);
        });
        this.selected.length = 0;
        if (save) parent.snapshot.save(0b10);
        this.updateView();
    };
    this.clearSelected = () => {  // 取消已选
        this.selected.forEach(v => { v.selected = false; });
        this.selected.length = 0;
    };

    var _tempdy = 0;
    this.changeNoteY = () => {  // 要求在trackMouse之后添加入spectrum的mousemoveEnent
        _anyAction = true;
        let dy = parent.Keyboard.highlight - 24 - this.clickYid;
        this.selected.forEach((v) => { v.y += dy - _tempdy; });
        _tempdy = dy;
        this.updateView();
    };

    // 记录操作音符时之前的值 由于changeNoteX和changeNoteDuration 互斥，因此共用
    var prevValue = null;
    /**
     * 改变选中的音符的时长 需要保证和changeNoteX同时只能使用一个
     * @param {MouseEvent} e 
     */
    this.changeNoteDuration = (e) => {
        _anyAction = true;
        // 兼容窗口滑动，以绝对坐标进行运算
        let dx = e.offsetX + parent.scrollX - this.clickX;
        // 此时prevValue存的是音符的v2*width值
        for (let i = 0; i < prevValue.length; i++) {
            const v = this.selected[i];
            const [l, r] = this.snapRound(prevValue[i] + dx);
            if (v.x1 >= r) {
                const [_, nr] = this.snapRound(v.x1 * parent._width);
                v.x2 = nr;
            } else v.x2 = r;
        }
    };
    this.changeNoteX = (e) => { // 由this.onclick_L调用
        _anyAction = true;
        let dx = e.offsetX + parent.scrollX - this.clickX;
        // 此时prevValue存的是音符的v1*width值
        for (let i = 0; i < prevValue.length; i++) {
            const v = this.selected[i];
            const d = v.x2 - v.x1;
            const [l, r] = this.snapRound(prevValue[i] + dx);
            v.x1 = Math.max(0, l);
            v.x2 = v.x1 + d;
        }
    };
    // 封装事件管理
    const startMove = () => {
        prevValue = this.selected.map(v => v.x1 * parent._width);
        parent.layerContainer.addEventListener('mousemove', this.changeNoteX);
        parent.layerContainer.addEventListener('mousemove', this.changeNoteY);
        const removeEvent = () => {
            parent.layerContainer.removeEventListener('mousemove', this.changeNoteX);
            parent.layerContainer.removeEventListener('mousemove', this.changeNoteY);
            document.removeEventListener('mouseup', removeEvent);
            this.midi.sort((a, b) => a.x1 - b.x1);   // 排序非常重要 因为查找被点击的音符依赖顺序
            // 鼠标松开则存档
            if (_anyAction) parent.snapshot.save(0b10);
        }; document.addEventListener('mouseup', removeEvent);

    };
    const startDurationChange = () => {
        prevValue = this.selected.map(v => v.x2 * parent._width);
        parent.layerContainer.addEventListener('mousemove', this.changeNoteDuration);
        parent.layerContainer.addEventListener('mousemove', this.changeNoteY);
        const removeEvent = () => {
            parent.layerContainer.removeEventListener('mousemove', this.changeNoteDuration);
            parent.layerContainer.removeEventListener('mousemove', this.changeNoteY);
            document.removeEventListener('mouseup', removeEvent);
            // 鼠标松开则存档
            if (_anyAction) parent.snapshot.save(0b10);
        }; document.addEventListener('mouseup', removeEvent);
    };
    /**
     * 框选音符的鼠标动作 由this.onclick_L调用
     * 选中的标准：框住了音头
     */
    this.selectAction = (mode = 0) => {
        const clickXid = this.clickX / parent._width | 0;   // 选择动作永远以格点为准
        this.frameXid = clickXid; // 先置大于零，表示开始绘制
        if (mode == 1) {    // 列选
            parent.layerContainer.addEventListener('mousemove', parent.trackMouseX);
            const up = () => {
                parent.layerContainer.removeEventListener('mousemove', parent.trackMouseX);
                document.removeEventListener('mouseup', up);
                let ch = this.channelDiv.selected;
                if (ch && !ch.lock) {
                    ch = ch.index;
                    let [xmin, xmax] = clickXid <= this.frameXid ? [clickXid, this.frameXid + 1] : [this.frameXid, clickXid + 1];
                    for (const nt of this.midi) nt.selected = (nt.x1 >= xmin && nt.x1 < xmax && nt.ch == ch);
                    this.selected = this.midi.filter(v => v.selected);
                } this.frameXid = -1;
            }; document.addEventListener('mouseup', up);
        } else if (mode == 2) { // 行选
            const up = () => {
                document.removeEventListener('mouseup', up);
                let ch = this.channelDiv.selected;
                if (ch && !ch.lock) {
                    ch = ch.index;
                    const Y = parent.Keyboard.highlight - 24;
                    let [ymin, ymax] = Y <= this.clickYid ? [Y, this.clickYid + 1] : [this.clickYid, Y + 1];
                    for (const nt of this.midi) nt.selected = (nt.y >= ymin && nt.y < ymax && nt.ch == ch);
                    this.selected = this.midi.filter(v => v.selected);
                } this.frameXid = -1;
            }; document.addEventListener('mouseup', up);
        } else {    // 框选
            parent.layerContainer.addEventListener('mousemove', parent.trackMouseX);
            const up = () => {
                parent.layerContainer.removeEventListener('mousemove', parent.trackMouseX);
                document.removeEventListener('mouseup', up);
                let ch = this.channelDiv.selected;
                if (ch && !ch.lock) {
                    ch = ch.index;
                    const Y = parent.Keyboard.highlight - 24;
                    let [xmin, xmax] = clickXid <= this.frameXid ? [clickXid, this.frameXid + 1] : [this.frameXid, clickXid + 1];
                    let [ymin, ymax] = Y <= this.clickYid ? [Y, this.clickYid + 1] : [this.clickYid, Y + 1];
                    for (const nt of this.midi) nt.selected = (nt.x1 >= xmin && nt.x1 < xmax && nt.y >= ymin && nt.y < ymax && nt.ch == ch);
                    this.selected = this.midi.filter(v => v.selected);
                } this.frameXid = -1;    // 表示不在框选
            }; document.addEventListener('mouseup', up);
        }
    };
    /**
     * 添加音符的鼠标动作 由this.onclick_L调用
     */
    this.addNoteAction = () => {
        if (!this.channelDiv.selected && !this.channelDiv.selectChannel(0)) return;   // 如果没有选中则默认第一个
        if (this.channelDiv.selected.lock) return;    // 锁定的音轨不能添加音符
        // 取消已选
        this.clearSelected();
        // 添加新音符，设置已选
        const [x1, x2] = this.snapRound(this.clickX);
        const note = {
            y: this.clickYid,
            x1, x2,
            ch: this.channelDiv.selected.index,
            selected: true
        }; this.selected.push(note);
        {   // 二分插入
            let l = 0, r = this.midi.length;
            while (l < r) {
                let mid = (l + r) >> 1;
                if (this.midi[mid].x1 < note.x1) l = mid + 1;
                else r = mid;
            } this.midi.splice(l, 0, note);
        }
        _anyAction = true;
        this.updateView();
        startDurationChange();
    };
    /**
     * MidiAction所有鼠标操作都由此分配
     */
    this.onclick_L = (e) => {
        //== step 1: 判断是否点在了音符上 ==//
        _anyAction = false;
        // 为了支持在鼠标操作的时候能滑动，记录绝对位置
        _tempdy = 0;
        const x = (this.clickX = e.offsetX + parent.scrollX) / parent._width;
        if (x >= parent._xnum) {   // 越界
            this.clearSelected(); return;
        }
        const y = this.clickYid = parent.Keyboard.highlight - 24;
        // 找到点击的最近的音符 由于点击不经常，所以用遍历足矣 只需要遍历insight的音符
        let n = null;
        for (let ch_id = 0; ch_id < this.insight.length; ch_id++) {
            const chitem = this.channelDiv.channel[ch_id]      // insight和channelDiv的顺序是一致的
            if (!chitem.visible || chitem.lock) continue;   // 隐藏、锁定的音轨选不中
            const ch = this.insight[ch_id];
            // 每层挑选左侧最靠近的（如果有多个）
            let distance = parent._width * parent._xnum;
            for (const nt of ch) {  // 由于来自midi，因此每个音轨内部是有序的
                let dis = x - nt.x1;
                if (dis < 0) break;
                if (y == nt.y && x < nt.x2) {
                    if (dis < distance) {
                        distance = dis;
                        n = nt;
                    }
                }
            } if (n) break; // 只找最上层的
        }
        if (!n) {   // 添加或框选音符 关于lock的处理在函数中
            if (this.mode) this.selectAction(this.frameMode);
            else this.addNoteAction();
            return;
        }
        this.channelDiv.selectChannel(n.ch);
        //== step 2: 如果点击到了音符，ctrl是否按下 ==/
        if (e.ctrlKey) {        // 有ctrl表示多选
            if (n.selected) {   // 已经选中了，取消选中
                this.selected.splice(this.selected.indexOf(n), 1);
                n.selected = false;
            } else {            // 没选中，添加选中
                this.selected.push(n);
                n.selected = true;
            } return;
        }
        //== step 3: 单选时，是否选中了多个(事关什么时候取消选中) ==//
        if (this.selected.length > 1 && n.selected) {    // 如果选择了多个，在松开鼠标的时候处理选中
            const up = () => {
                if (!_anyAction) {    // 没有任何拖拽动作，说明为了单选
                    this.selected.forEach(v => { v.selected = false; });
                    this.selected.length = 0;
                    n.selected = true;
                    this.selected.push(n);
                }
                document.removeEventListener('mouseup', up);
            }; document.addEventListener('mouseup', up);
        } else {    // 只选一个
            if (n.selected) {
                const up = () => {
                    if (!_anyAction) {    // 没有任何拖拽动作，说明为了取消选中
                        this.selected.forEach(v => { v.selected = false; });
                        this.selected.length = 0;
                    } document.removeEventListener('mouseup', up);
                }; document.addEventListener('mouseup', up);
            } else {
                this.selected.forEach(v => { v.selected = false; });
                this.selected.length = 0;
                n.selected = true;
                this.selected.push(n);
            }
        }
        //== step 4: 如果点击到了音符，添加移动事件 ==//
        if (((e.offsetX + parent.scrollX) << 1) > (n.x2 + n.x1) * parent._width) {    // 靠近右侧，调整时长
            startDurationChange();
        } else {    // 靠近左侧，调整位置
            startMove();
        }
    };
}