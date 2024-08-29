// 用这种方式(原始构造函数)的原因：解耦太难了，不解了。this全部指同一个
// 防止在html初始化之前getElement，所以封装成了构造函数，而不是直接写obj
function App() {
    this.event = new EventTarget();
    this.spectrum = document.getElementById('spectrum');
    this.spectrum.ctx = this.spectrum.getContext('2d'); // 绘制相关参数的更改在this.resize中
    this.keyboard = document.getElementById('piano');
    this.keyboard.ctx = this.keyboard.getContext('2d', { alpha: false, desynchronized: true });
    this.timeBar = document.getElementById('timeBar');
    this.timeBar.ctx = this.timeBar.getContext('2d', { alpha: false, desynchronized: true });
    this.midiMode = false;
    this._width = 5;    // 每格的宽度
    Object.defineProperty(this, 'width', {
        get: function () { return this._width; },
        set: function (w) {
            if (w <= 0) return;
            this._width = w;
            this.TimeBar.updateInterval();
            this.HscrollBar.refreshSize();  // 刷新横向滑动条
            this.TperP = this.dt / this._width;  // 每个像素代表的时间
            this.PperT = this._width / this.dt;  // 每个时间代表的像素
        }
    });
    this._height = 15;   // 每格的高度
    Object.defineProperty(this, 'height', {
        get: function () { return this._height; },
        set: function (h) {
            if (h <= 0) return;
            this._height = h;
            this.Keyboard._ychange.set([
                -1.5 * h, -2 * h, -1.5 * h, -1.5 * h, -2 * h, -2 * h, -1.5 * h,
                -2 * h, -3 * h, -2 * h, -2 * h, -2 * h
            ]);
            this.keyboard.ctx.font = `${h + 2}px Arial`;
            this.spectrum.ctx.font = `${h}px Arial`;
        }
    });
    this.ynum = 84;     // 一共84个按键
    this._xnum = 0;     // 时间轴的最大长度
    Object.defineProperty(this, 'xnum', {   // midi模式下需要经常改变此值，故特设setter
        get: function () { return this._xnum; },
        set: function (n) {
            if (n <= 0) return;
            this._xnum = n;
            this.HscrollBar.refreshSize();  // 刷新横向滑动条
            this.idXend = Math.min(this._xnum, Math.ceil((this.scrollX + this.spectrum.width) / this._width));
        }
    });
    this.scrollX = 0;   // 视野左边和世界左边的距离
    this.scrollY = 0;   // 视野下边和世界下边的距离
    this.idXstart = 0;  // 开始的X序号
    this.idYstart = 0;  // 开始的Y序号
    this.idXend = 0;    // 在scroll2中更新
    this.idYend = 0;
    this.rectXstart = 0;// 目前只有Spectrogram.update在使用
    this.rectYstart = 0;// 画布开始的具体y坐标(因为最下面一个不完整) 迭代应该减height 被画频谱、画键盘共享
    this.loop = 0;      // 接收requestAnimationFrame的返回
    this.time = -1;     // 当前时间 单位：毫秒 在this.AudioPlayer.update中更新
    this.dt = 50;       // 每次分析的时间间隔 单位毫秒 在this.Analyser.analyse中更新
    this._mouseY = 0;   // 鼠标当前y坐标
    Object.defineProperty(this, 'mouseY', {
        get: function () { return this._mouseY; },
        set: function (y) {
            this._mouseY = y;
            this.Keyboard.highlight = Math.floor((this.scrollY + this.spectrum.height - y) / this._height) + 24;
        }
    });
    this._mouseX = 0;   // 鼠标当前x坐标
    Object.defineProperty(this, 'mouseX', {
        get: function () { return this._mouseX; },
        set: function (x) {
            this._mouseX = x;
            this.MidiAction.frameXid = Math.floor((x + this.scrollX) / this._width);
        }
    });
    this.audioContext = new AudioContext({ sampleRate: 44100 });
    this.synthesizer = new TinySynth(this.audioContext);
    this.Spectrogram = {
        parent: this,
        colorStep1: 100,
        colorStep2: 240,
        multiple: parseFloat(document.getElementById('multiControl').value),// 幅度的倍数
        _spectrogram: null,
        mask: '#25262daa',
        getColor: (value) => {  // 0-step1，是蓝色的亮度从0变为50%；step1-step2，是颜色由蓝色变为红色；step2-255，保持红色
            value = value || 0;
            let hue = 0, lightness = 50;    // Red hue
            if (value <= this.Spectrogram.colorStep1) {
                hue = 240; // Blue hue
                lightness = (value / this.Spectrogram.colorStep1) * 50; // Lightness from 0% to 50%
            } else if (value <= this.Spectrogram.colorStep2) {
                hue = 240 - ((value - this.Spectrogram.colorStep1) / (this.Spectrogram.colorStep2 - this.Spectrogram.colorStep1)) * 240;
            } return `hsl(${hue}, 100%, ${lightness}%)`;
        },
        update: () => { // 不能用画图的坐标去限制，因为数据可能填不满画布 必须用id
            const sp = this.Spectrogram;
            const canvas = this.spectrum;
            const ctx = this.spectrum.ctx;
            let rectx = this.rectXstart;
            for (let x = this.idXstart; x < this.idXend; x++) {
                const s = sp._spectrogram[x];
                let recty = this.rectYstart;
                for (let y = this.idYstart; y < this.idYend; y++) {
                    ctx.fillStyle = sp.getColor(s[y] * sp.multiple);
                    ctx.fillRect(rectx, recty, this._width, -this._height);
                    recty -= this._height;
                }
                rectx += this._width;
            }
            let w = canvas.width - rectx;
            // 画分界线
            ctx.strokeStyle = "#FFFFFF";
            ctx.beginPath();
            for (let y = (((this.idYstart / 12) | 0) + 1) * 12,
                rectY = canvas.height - this.height * y + this.scrollY,
                dy = -12 * this.height;
                y < this.idYend; y += 12, rectY += dy) {
                ctx.moveTo(0, rectY);
                ctx.lineTo(canvas.width, rectY);
            } ctx.stroke();
            // 填涂剩余部分
            if (w > 0) {
                ctx.fillStyle = '#25262d';
                ctx.fillRect(rectx, 0, w, canvas.height);
            }
            // 铺底色以凸显midi音符
            ctx.fillStyle = sp.mask;
            ctx.fillRect(0, 0, rectx, canvas.height);
            // 更新note
            ctx.fillStyle = "#ffffff4f";
            rectx = canvas.height - (this.Keyboard.highlight - 24) * this._height + this.scrollY;
            ctx.fillRect(0, rectx, canvas.width, -this._height);
        },
        // 注意，getter 和 setter 的this指向为Spectrogram
        get spectrogram() {
            return this._spectrogram;
        },
        set spectrogram(s) {
            if (!s) {
                this._spectrogram = null;
                this.parent.xnum = 0;
            } else {
                this._spectrogram = s;
                this.parent.xnum = s.length;    // 触发HscrollBar.refreshSize
                this.parent.scroll2();          // 保持位置不变 本来是为了“一边分析一边绘制频谱”而设计的，虽然减少了等待但容易崩而且卡
            }
        },
        get Alpha() {
            return parseInt(this.mask.substring(7), 16);
        },
        set Alpha(a) {
            a = Math.min(255, Math.max(a | 0, 0));
            this.mask = '#25262d' + a.toString(16);
        }
    };
    this.MidiAction = {
        clickXid: 0,
        clickYid: 0,

        mode: 0,    // 0: 笔模式 1: 选择模式
        frameMode: 0,   // 0: 框选 1: 列选 2: 行选
        frameXid: -1,   // 框选的终点的X序号(Y序号=this.Keyboard.highlight-24) 此变量便于绘制 如果是负数则不绘制

        _tempdx: 0, // 鼠标移动记录上次
        _tempdy: 0,
        _anyAction: false,  // 用于在选中多个后判断松开鼠标时应该如何处理选中
        /* 一个音符 = {
            y: 离散 和spectrum的y一致
            x1: 离散 起点
            x2: 离散 终点
            ch: 音轨序号
            selected: 是否选中
        } */
        selected: [],   // 选中的音符 无序即可
        midi: [],       // 所有音符 需要维护有序性
        // 多音轨
        channelDiv: (() => {
            const cd = new ChannelList(document.getElementById('funcSider'), this.synthesizer);
            const saveOnReorder = () => this.snapshot.save();
            const waitReorder = () => {
                setTimeout(() => {
                    this.snapshot.save();
                    this.MidiAction.updateView();
                    cd.addEventListener('reorder', saveOnReorder);
                }, 0); // 等待reorder的发生
            }
            cd.addEventListener('reorder', ({ detail }) => {
                for (const nt of this.MidiAction.midi) {
                    nt.ch = detail[nt.ch];
                } this.MidiAction.updateView();
            });
            cd.addEventListener('reorder', saveOnReorder);
            cd.addEventListener('remove', ({ detail }) => {
                cd.removeEventListener('reorder', saveOnReorder);
                this.MidiAction.midi = this.MidiAction.midi.filter((nt) => nt.ch != detail.index);
                this.MidiAction.selected = this.MidiAction.selected.filter((nt) => nt.ch != detail.index);
                waitReorder();
            });
            cd.addEventListener('add', () => {
                cd.removeEventListener('reorder', saveOnReorder);
                waitReorder();
            });
            return cd;
        })(),
        insight: [],    // 二维数组，每个元素为一个音轨视野内的音符 音符拾取依赖此数组
        /**
         * 更新this.MidiAction.insight
         * 步骤繁琐，不必每次更新。触发时机:
         * 1. channelDiv的reorder
         * 2. midi的增删移动改变长度。由于都会调用且最后调用changeNoteY，所以只需要在changeNoteY中调用
         * 3. scroll2
         * 4. deleteNote
         * 5. ctrlZ、ctrlY、ctrlV
         */
        updateView: () => {
            const m = this.MidiAction.midi;
            const channel = Array.from(this.MidiAction.channelDiv.channel, () => []);
            this.MidiAction.insight = channel;
            // 原来用的二分有bug，所以干脆全部遍历
            for (const nt of m) {
                if (nt.x1 >= this.idXend) break;
                if (nt.x2 < this.idXstart) continue;
                if (nt.y < this.idYstart || nt.y >= this.idYend) continue;
                channel[nt.ch].push(nt);
            }
            // midi模式下，视野要比音符宽一页，或超出视野半页
            if(this.midiMode) {
                const currentLen = this.Spectrogram.spectrogram.length;
                let apage = this.spectrum.width / this._width;
                let minLen = (m.length ? m[m.length - 1].x2 : 0) + apage * 1.5 | 0;
                let viewLen = this.idXstart + apage | 0;    // 如果视野在很外面，需要保持视野
                if(viewLen > minLen) minLen = viewLen;
                if(minLen != currentLen) this.Spectrogram.spectrogram.length = minLen;   // length触发audio.duration和this.xnum
            }
        },
        update: () => {     // 按照insight绘制音符
            const M = this.MidiAction;
            const m = M.insight;
            const s = this.spectrum.ctx;
            const c = M.channelDiv.channel;
            for (let ch = m.length - 1; ch >= 0; ch--) {
                if (m[ch].length === 0 || (c[ch] && !c[ch].visible)) continue;
                let ntcolor = c[ch].color;
                for (const note of m[ch]) {
                    const params = [note.x1 * this._width - this.scrollX, this.spectrum.height - note.y * this._height + this.scrollY, (note.x2 - note.x1) * this._width, -this._height];
                    if (note.selected) {
                        s.fillStyle = '#ffffff';
                        s.fillRect(...params);
                        s.strokeStyle = ntcolor;
                        s.strokeRect(...params);
                    } else {
                        s.fillStyle = ntcolor;
                        s.fillRect(...params);
                        s.strokeStyle = '#ffffff';
                        s.strokeRect(...params);
                    }
                }
            } if (!M.mode || M.frameXid < 0) return;
            // 绘制框选动作
            s.fillStyle = '#f0f0f088';
            let [xmin, xmax] = M.clickXid <= M.frameXid ? [M.clickXid, M.frameXid + 1] : [M.frameXid, M.clickXid + 1];
            const Y = this.Keyboard.highlight - 24;
            let [ymin, ymax] = Y <= M.clickYid ? [Y, M.clickYid + 1] : [M.clickYid, Y + 1];
            let x1, x2, y1, y2;
            if (M.frameMode == 1) {  // 列选
                x1 = xmin * this._width - this.scrollX;
                x2 = (xmax - xmin) * this._width;
                y1 = 0;
                y2 = this.spectrum.height;
            } else if (M.frameMode == 2) {   // 行选
                x1 = 0;
                x2 = this.spectrum.width;
                y1 = this.spectrum.height - ymax * this._height + this.scrollY;
                y2 = (ymax - ymin) * this._height;
            } else {    // 框选
                x1 = xmin * this._width - this.scrollX;
                x2 = (xmax - xmin) * this._width;
                y1 = this.spectrum.height - ymax * this._height + this.scrollY;
                y2 = (ymax - ymin) * this._height;
            } s.fillRect(x1, y1, x2, y2);
        },
        deleteNote: (save = true) => {
            this.MidiAction.selected.forEach((v) => {
                let i = this.MidiAction.midi.indexOf(v);
                if (i != -1) this.MidiAction.midi.splice(i, 1);
            });
            this.MidiAction.selected.length = 0;
            if (save) this.snapshot.save();
            this.MidiAction.updateView();
        },
        clearSelected: () => {  // 取消已选
            this.MidiAction.selected.forEach(v => { v.selected = false; });
            this.MidiAction.selected.length = 0;
        },
        /**
         * 改变选中的音符的时长 依赖相对于点击位置的移动改变长度 所以需要提前准备好clickX
         * 需要保证和changeNoteX同时只能使用一个
         * @param {MouseEvent} e 
         */
        changeNoteDuration: (e) => {
            this.MidiAction._anyAction = true;
            // 兼容窗口滑动，以绝对坐标进行运算
            let dx = (((e.offsetX + this.scrollX) / this._width) | 0) - this.MidiAction.clickXid;
            this.MidiAction.selected.forEach((v) => {
                if ((v.x2 += dx - this.MidiAction._tempdx) <= v.x1) v.x2 = v.x1 + 1;
            });
            this.MidiAction._tempdx = dx;
        },
        changeNoteY: () => {    // 要求在trackMouse之后添加入spectrum的mousemoveEnent
            this.MidiAction._anyAction = true;
            let dy = this.Keyboard.highlight - 24 - this.MidiAction.clickYid;
            this.MidiAction.selected.forEach((v) => {
                v.y += dy - this.MidiAction._tempdy;
            });
            this.MidiAction._tempdy = dy;
            this.MidiAction.updateView();
        },
        changeNoteX: (e) => {
            this.MidiAction._anyAction = true;
            let dx = (((e.offsetX + this.scrollX) / this._width) | 0) - this.MidiAction.clickXid;
            this.MidiAction.selected.forEach((v) => {
                let d = v.x2 - v.x1;
                if ((v.x1 += dx - this.MidiAction._tempdx) < 0) v.x1 = 0; // 越界则设置为0
                v.x2 = v.x1 + d;
            });
            this.MidiAction._tempdx = dx;
        },
        /**
         * 框选音符的鼠标动作 由this.MidiAction.onclick_L调用
         * 选中的标准：框住了音头
         */
        selectAction: (mode = 0) => {
            const m = this.MidiAction;
            m.frameXid = m.clickXid; // 先置大于零，表示开始绘制
            if (mode == 1) {    // 列选
                this.spectrum.addEventListener('mousemove', this.trackMouseX);
                const up = () => {
                    this.spectrum.removeEventListener('mousemove', this.trackMouseX);
                    document.removeEventListener('mouseup', up);
                    let ch = m.channelDiv.selected;
                    if (ch) {
                        ch = ch.index;
                        let [xmin, xmax] = m.clickXid <= m.frameXid ? [m.clickXid, m.frameXid + 1] : [m.frameXid, m.clickXid + 1];
                        for (const nt of m.midi) nt.selected = (nt.x1 >= xmin && nt.x1 < xmax && nt.ch == ch);
                        m.selected = m.midi.filter(v => v.selected);
                    } m.frameXid = -1;
                }; document.addEventListener('mouseup', up);
            } else if (mode == 2) { // 行选
                const up = () => {
                    document.removeEventListener('mouseup', up);
                    let ch = m.channelDiv.selected;
                    if (ch) {
                        ch = ch.index;
                        const Y = this.Keyboard.highlight - 24;
                        let [ymin, ymax] = Y <= m.clickYid ? [Y, m.clickYid + 1] : [m.clickYid, Y + 1];
                        for (const nt of m.midi) nt.selected = (nt.y >= ymin && nt.y < ymax && nt.ch == ch);
                        m.selected = m.midi.filter(v => v.selected);
                    } m.frameXid = -1;
                }; document.addEventListener('mouseup', up);
            } else {    // 框选
                this.spectrum.addEventListener('mousemove', this.trackMouseX);
                const up = () => {
                    this.spectrum.removeEventListener('mousemove', this.trackMouseX);
                    document.removeEventListener('mouseup', up);
                    let ch = m.channelDiv.selected;
                    if (ch) {
                        ch = ch.index;
                        const Y = this.Keyboard.highlight - 24;
                        let [xmin, xmax] = m.clickXid <= m.frameXid ? [m.clickXid, m.frameXid + 1] : [m.frameXid, m.clickXid + 1];
                        let [ymin, ymax] = Y <= m.clickYid ? [Y, m.clickYid + 1] : [m.clickYid, Y + 1];
                        for (const nt of m.midi) nt.selected = (nt.x1 >= xmin && nt.x1 < xmax && nt.y >= ymin && nt.y < ymax && nt.ch == ch);
                        m.selected = m.midi.filter(v => v.selected);
                    } m.frameXid = -1;    // 表示不在框选
                }; document.addEventListener('mouseup', up);
            }
        },
        /**
         * 添加音符的鼠标动作 由this.MidiAction.onclick_L调用
         */
        addNoteAction: () => {
            const m = this.MidiAction;
            if (!m.channelDiv.selected && !m.channelDiv.selectChannel(0)) return;   // 如果没有选中则默认第一个
            // 取消已选
            m.clearSelected();
            // 添加新音符，设置已选
            const note = {
                y: m.clickYid,
                x1: m.clickXid,
                x2: m.clickXid + 1,
                ch: m.channelDiv.selected.index,
                selected: true
            }; m.selected.push(note);
            {   // 二分插入
                let l = 0, r = m.midi.length;
                while (l < r) {
                    let mid = (l + r) >> 1;
                    if (m.midi[mid].x1 < note.x1) l = mid + 1;
                    else r = mid;
                } m.midi.splice(l, 0, note);
            }
            m._anyAction = true;
            m.updateView();
            this.spectrum.addEventListener('mousemove', m.changeNoteDuration);
            this.spectrum.addEventListener('mousemove', m.changeNoteY);
            const removeEvent = () => {
                this.spectrum.removeEventListener('mousemove', m.changeNoteDuration);
                this.spectrum.removeEventListener('mousemove', m.changeNoteY);
                document.removeEventListener('mouseup', removeEvent);
                // 鼠标松开则存档
                if (m._anyAction) this.snapshot.save();
            }; document.addEventListener('mouseup', removeEvent);
        },
        onclick_L: (e) => {
            //== step 1: 判断是否点在了音符上 ==//
            const m = this.MidiAction;
            const midi = m.midi;
            m._anyAction = false;
            // 为了支持在鼠标操作的时候能滑动，记录绝对位置
            m._tempdx = m._tempdy = 0;
            const x = m.clickXid = ((e.offsetX + this.scrollX) / this._width) | 0;
            if (x >= this._xnum) {   // 越界
                m.clearSelected(); return;
            }
            const y = m.clickYid = this.Keyboard.highlight - 24;
            // 找到点击的最近的音符 由于点击不经常，所以用遍历足矣 只需要遍历insight的音符
            let n = null;
            for (const ch of m.insight) {
                // 每层挑选左侧最靠近的（如果有多个）
                let distance = this._width * this._xnum;
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
            if (!n) {   // 添加或框选音符
                if (m.mode) m.selectAction(m.frameMode);
                else m.addNoteAction();
                return;
            }
            m.channelDiv.selectChannel(n.ch);
            //== step 2: 如果点击到了音符，ctrl是否按下 ==/
            if (e.ctrlKey) {        // 有ctrl表示多选
                if (n.selected) {   // 已经选中了，取消选中
                    m.selected.splice(m.selected.indexOf(n), 1);
                    n.selected = false;
                } else {            // 没选中，添加选中
                    m.selected.push(n);
                    n.selected = true;
                } return;
            }
            //== step 3: 单选时，是否选中了多个(事关什么时候取消选中) ==//
            if (m.selected.length > 1 && n.selected) {    // 如果选择了多个，在松开鼠标的时候处理选中
                const up = () => {
                    if (!m._anyAction) {    // 没有任何拖拽动作，说明为了单选
                        m.selected.forEach(v => { v.selected = false; });
                        m.selected.length = 0;
                        n.selected = true;
                        m.selected.push(n);
                    }
                    document.removeEventListener('mouseup', up);
                }; document.addEventListener('mouseup', up);
            } else {    // 只选一个
                if (n.selected) {
                    const up = () => {
                        if (!m._anyAction) {    // 没有任何拖拽动作，说明为了取消选中
                            m.selected.forEach(v => { v.selected = false; });
                            m.selected.length = 0;
                        } document.removeEventListener('mouseup', up);
                    }; document.addEventListener('mouseup', up);
                } else {
                    m.selected.forEach(v => { v.selected = false; });
                    m.selected.length = 0;
                    n.selected = true;
                    m.selected.push(n);
                }
            }
            //== step 4: 如果点击到了音符，添加移动事件 ==//
            if (((e.offsetX + this.scrollX) << 1) > (n.x2 + n.x1) * this._width) {    // 靠近右侧，调整时长
                this.spectrum.addEventListener('mousemove', m.changeNoteDuration);
                this.spectrum.addEventListener('mousemove', m.changeNoteY);
                const removeEvent = () => {
                    this.spectrum.removeEventListener('mousemove', m.changeNoteDuration);
                    this.spectrum.removeEventListener('mousemove', m.changeNoteY);
                    document.removeEventListener('mouseup', removeEvent);
                    // 鼠标松开则存档
                    if (m._anyAction) this.snapshot.save();
                }; document.addEventListener('mouseup', removeEvent);
            } else {    // 靠近左侧，调整位置
                this.spectrum.addEventListener('mousemove', m.changeNoteX);
                this.spectrum.addEventListener('mousemove', m.changeNoteY);
                const removeEvent = () => {
                    this.spectrum.removeEventListener('mousemove', m.changeNoteX);
                    this.spectrum.removeEventListener('mousemove', m.changeNoteY);
                    document.removeEventListener('mouseup', removeEvent);
                    this.MidiAction.midi.sort((a, b) => a.x1 - b.x1);   // 排序非常重要 因为查找被点击的音符依赖顺序
                    // 鼠标松开则存档
                    if (m._anyAction) this.snapshot.save();
                }; document.addEventListener('mouseup', removeEvent);
            }
        },
    };
    this.MidiPlayer = {
        priorT: 1000 / 59,      // 实际稳定在60帧，波动极小
        realT: 1000 / 59,
        _last: performance.now(),
        lastID: -1,
        restart: () => {
            // 需要-1，防止当前时刻开始的音符不被播放
            this.MidiPlayer.lastID = ((this.AudioPlayer.audio.currentTime * 1000 / this.dt) | 0) - 1;
        },
        update: () => {
            const mp = this.MidiPlayer;
            // 一阶预测
            let tnow = performance.now();
            // 由于requestAnimationFrame在离开界面的时候会停止，所以要设置必要的限定
            if (tnow - mp._last < (mp.priorT << 1)) mp.realT = 0.2 * (tnow - mp._last) + 0.8 * mp.realT;   // IIR低通滤波
            mp._last = tnow;
            if (this.AudioPlayer.audio.paused) return;
            let predictT = this.time + 0.5 * (mp.realT + mp.priorT); // 先验和实测的加权和
            let predictID = (predictT / this.dt) | 0;
            // 寻找(mp.lastID, predictID]之间的音符
            const m = this.MidiAction.midi;
            if (m.length > 0) { // 二分查找要求长度大于0
                let lastAt = m.length;
                {   // 二分查找到第一个x1>mp.lastID的音符
                    let l = 0, r = lastAt - 1;
                    while (l <= r) {
                        let mid = (l + r) >> 1;
                        if (m[mid].x1 > mp.lastID) {
                            r = mid - 1;
                            lastAt = mid;
                        } else l = mid + 1;
                    }
                }
                for (; lastAt < m.length; lastAt++) {
                    const nt = m[lastAt];
                    if (nt.x1 > predictID) break;
                    if (this.MidiAction.channelDiv.channel[nt.ch].mute) continue;
                    this.synthesizer.play({
                        id: nt.ch,
                        f: this.Keyboard.freqTable[nt.y],
                        t: this.AudioPlayer.audio.currentTime - (nt.x1 * this.dt) / 1000,
                        last: (nt.x2 - nt.x1) * this.dt / 1000
                    });
                }
            }
            mp.lastID = predictID;
        }
    };
    this.AudioPlayer = {
        name: "请上传文件",  // 在this.Analyser.onfile中赋值
        audio: new Audio(), // 在this.Analyser.onfile中重新赋值 此处需要一个占位
        play_btn: document.getElementById('play-btn'),
        durationString: '', // 在this.Analyser.audio.ondurationchange中更新
        autoPage: false,    // 自动翻页
        repeat: true,       // 是否区间循环
        _crossFlag: false,  // 上一时刻是否在重复区间终点左侧
        EQfreq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
        // midiMode下url为duration
        createAudio: (url) => {
            return new Promise((resolve, reject) => {
                const a = this.midiMode ? new FakeAudio(url) : new Audio(url);
                a.loop = false;
                a.volume = parseFloat(document.getElementById('audiovolumeControl').value);
                a.ondurationchange = () => {
                    let ms = a.duration * 1000;
                    this.AudioPlayer.durationString = this.TimeBar.msToClockString(ms);
                    this.BeatBar.beats.maxTime = ms;
                };
                a.onended = () => {
                    this.time = 0;
                    this.AudioPlayer.stop();
                };
                a.onloadeddata = () => {
                    const ap = this.AudioPlayer;
                    if (!this.midiMode) {
                        ap.setEQ();
                        if (this.audioContext.state == 'suspended') this.audioContext.resume().then(() => a.pause());
                        document.title = ap.name + "~扒谱";
                    } else {
                        document.title = ap.name;
                    }
                    a.playbackRate = document.getElementById('speedControl').value; // load之后会重置速度
                    this.time = 0;
                    resolve(a);
                    a.onloadeddata = null;  // 一次性 防止多次构造
                    ap.play_btn.firstChild.textContent = this.TimeBar.msToClockString(this.time);
                    ap.play_btn.lastChild.textContent = ap.durationString;
                };
                a.onerror = (e) => {    // 如果正常分析，是用不到这个回调的，因为WebAudioAPI读取就会报错。但上传已有结果不会再分析
                    // 发现一些如mov格式的视频，不在video/的支持列表中，用.readAsDataURL转为base64后无法播放，会触发这个错误
                    // 改正方法是用URL.createObjectURL(file)生成一个blob地址而不是解析为base64
                    reject(e);
                    this.event.dispatchEvent(new Event('fileerror'));
                };
                this.AudioPlayer.setAudio(a);
            });
        },
        update: () => {
            const A = this.AudioPlayer;
            const a = A.audio;
            const btn = A.play_btn;
            if (a.readyState != 4 || a.paused) return;
            this.time = a.currentTime * 1000;  // 【重要】更新时间
            // 重复区间
            let crossFlag = this.time < this.TimeBar.repeatEnd;
            if (A.repeat && this.TimeBar.repeatEnd >= this.TimeBar.repeatStart) {   // 重复且重复区间有效
                let crossFlag = this.time < this.TimeBar.repeatEnd;
                if (A._crossFlag && !crossFlag) {  // 从重复区间终点左侧到右侧
                    this.time = this.TimeBar.repeatStart;
                    a.currentTime = this.time / 1000;
                }
            }
            A._crossFlag = crossFlag;
            btn.firstChild.textContent = this.TimeBar.msToClockString(this.time);
            btn.lastChild.textContent = A.durationString;
            // 自动翻页
            if (A.autoPage && (this.time > this.idXend * this.dt || this.time < this.idXstart * this.dt)) {
                this.scroll2(((this.time / this.dt - 1) | 0) * this._width, this.scrollY);  // 留一点空位
            }
        },
        /**
         * 在指定的毫秒数开始播放
         * @param {Number} at 开始的毫秒数 如果是负数，则从当下开始
         */
        start: (at) => {
            const a = this.AudioPlayer.audio;
            if (a.readyState != 4) return;
            if (at >= 0) a.currentTime = at / 1000;
            this.AudioPlayer._crossFlag = false;    // 置此为假可以暂时取消重复区间
            this.MidiPlayer.restart();
            if (a.readyState == 4) a.play();
            else a.oncanplay = () => {
                a.play();
                a.oncanplay = null;
            };
        },
        stop: () => {
            this.AudioPlayer.audio.pause();
            this.synthesizer.stopAll();
        },
        setEQ: (f = this.AudioPlayer.EQfreq) => {
            const a = this.AudioPlayer.audio;
            if (a.EQ) return;
            // 由于createMediaElementSource对一个audio只能调用一次，所以audio的EQ属性只能设置一次
            const source = this.audioContext.createMediaElementSource(a);
            let last = source;
            a.EQ = {
                source: source,
                filter: f.map((v) => {
                    const filter = this.audioContext.createBiquadFilter();
                    filter.type = "peaking";
                    filter.frequency.value = v;
                    filter.Q.value = 1;
                    filter.gain.value = 0;
                    last.connect(filter);
                    last = filter;
                    return filter;
                })
            };
            last.connect(this.audioContext.destination);
        },
        setAudio: (newAudio) => {
            const A = this.AudioPlayer.audio;
            if (A) {
                A.pause();
                A.onerror = null;   // 防止触发fileerror
                A.src = '';
                if (A.EQ) {
                    A.EQ.source.disconnect();
                    for (const filter of A.EQ.filter) filter.disconnect();
                }
                // 配合传参为URL.createObjectURL(file)使用，防止内存泄露
                URL.revokeObjectURL(this.AudioPlayer.audio.src);
            }
            this.AudioPlayer.audio = newAudio;
        }
    };
    this.Keyboard = {
        highlight: -1,   // 选中了哪个音 音的编号以midi协议为准 C1序号为24 根this.mouseY一起在onmousemove更新
        freqTable: new FreqTable(440),    // 在this.Analyser.analyse中赋值
        // 以下为画键盘所需
        _idchange: new Int8Array([2, 2, 1, 2, 2, 2, -10, 2, 3, 2, 2, 2]),   // id变化
        _ychange: new Float32Array(12), // 纵坐标变化，随this.height一起变化
        update: () => {
            const kbd = this.Keyboard;
            const ctx = this.keyboard.ctx;
            const w = this.keyboard.width;
            const w2 = w * 0.618;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, this.keyboard.height);

            let noteID = this.idYstart + 24;    // 最下面对应的音的编号
            let note = noteID % 12;             // 一个八度中的第几个音
            let baseY = this.rectYstart + note * this._height;   // 这个八度左下角的y坐标
            noteID -= note;                     // 这个八度C的编号

            while (true) {
                ctx.beginPath();    // 必须写循环内
                ctx.fillStyle = 'orange';
                for (let i = 0, rectY = baseY, id = noteID; i < 7 & rectY > 0; i++) {   // 画白键
                    let dy = kbd._ychange[i];
                    if (this.Keyboard.highlight == id) ctx.fillRect(0, rectY, w, dy);   // 被选中的
                    ctx.moveTo(0, rectY);   // 画线即可 下划线
                    ctx.lineTo(w, rectY);
                    rectY += dy;
                    id += kbd._idchange[i];
                } ctx.stroke();
                // 写音阶名
                ctx.fillStyle = "black"; ctx.fillText(Math.floor(noteID / 12) - 1, w - this._height * 0.75, baseY - this._height * 0.3);
                baseY -= this._height; noteID++;
                for (let i = 7; i < 12; i++) {
                    if (this.Keyboard.highlight == noteID) {    // 考虑到只要画一次高亮，不必每次都改fillStyle
                        ctx.fillStyle = '#Ffa500ff';
                        ctx.fillRect(0, baseY, w2, -this._height);
                        ctx.fillStyle = 'black';
                    } else ctx.fillRect(0, baseY, w2, -this._height);
                    baseY += kbd._ychange[i];
                    noteID += kbd._idchange[i];
                    if (baseY < 0) return;
                }
            }
        },
        mousedown: () => {  // 鼠标点击后发声
            let ch = this.MidiAction.channelDiv.selected;
            if (!ch || ch.mute) return;
            ch = ch ? ch.ch : this.synthesizer;
            let nt = ch.play({ f: this.Keyboard.freqTable[this.Keyboard.highlight - 24] });
            let last = this.Keyboard.highlight;     // 除颤
            const tplay = this.audioContext.currentTime;
            const move = () => {
                if (last === this.Keyboard.highlight) return;
                last = this.Keyboard.highlight;
                let dt = this.audioContext.currentTime - tplay;
                this.synthesizer.stop(nt, dt > 0.3 ? 0 : dt - 0.3);
                nt = ch.play({ f: this.Keyboard.freqTable[this.Keyboard.highlight - 24] });
            }; document.addEventListener('mousemove', move);
            const up = () => {
                let dt = this.audioContext.currentTime - tplay;
                this.synthesizer.stop(nt, dt > 0.5 ? 0 : dt - 0.5);
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            }; document.addEventListener('mouseup', up);
        }
    }; this.height = this._height; // 更新this.Keyboard._ychange
    this.TimeBar = {
        interval: 10,   // 每个标注的间隔块数 在updateInterval中更新
        // 重复区间参数 单位：毫秒 如果start>end则区间不起作用
        repeatStart: -1,
        repeatEnd: -1,
        /**
         * 毫秒转 分:秒:毫秒
         * @param {Number} ms 毫秒数
         * @returns [分,秒,毫秒]
         */
        msToClock: (ms) => {
            return [
                Math.floor(ms / 60000),
                Math.floor((ms % 60000) / 1000),
                ms % 1000 | 0
            ];
        },
        msToClockString: (ms) => {
            const t = this.TimeBar.msToClock(ms);
            return `${t[0].toString().padStart(2, "0")}:${t[1].toString().padStart(2, "0")}:${t[2].toString().padStart(3, "0")}`;
        },
        // timeBar的上半部分画时间轴
        update: () => {
            const canvas = this.timeBar;
            const ctx = this.timeBar.ctx;
            const tb = this.TimeBar;
            let idstart = Math.ceil(this.idXstart / tb.interval - 0.1);   // 画面中第一个时间点的序号
            let dt = tb.interval * this.dt;         // 时间的步长
            let dp = this.width * tb.interval;      // 像素的步长
            let timeAt = dt * idstart;              // 对应的毫秒
            let p = idstart * dp - this.scrollX;    // 对应的像素
            let h = canvas.height >> 1;             // 上半部分
            ctx.fillStyle = '#25262d';
            ctx.fillRect(0, 0, canvas.width, h);
            ctx.fillStyle = '#8e95a6';
            //== 画刻度 标时间 ==//
            ctx.strokeStyle = '#ff0000';
            ctx.beginPath();
            for (let endPix = canvas.width + (dp >> 1); p < endPix; p += dp, timeAt += dt) {
                ctx.moveTo(p, 0);
                ctx.lineTo(p, h);
                ctx.fillText(tb.msToClockString(timeAt), p - 28, 16);
            } ctx.stroke();
            //== 画重复区间 ==//
            let begin = this._width * tb.repeatStart / this.dt - this.scrollX;  // 单位：像素
            let end = this._width * tb.repeatEnd / this.dt - this.scrollX;
            const spectrum = this.spectrum.ctx;
            const spectrumHeight = this.spectrum.height;
            // 画线
            if (begin >= 0 && begin < canvas.width) {   // 画左边
                ctx.beginPath(); spectrum.beginPath();
                ctx.strokeStyle = spectrum.strokeStyle = '#20ff20';
                ctx.moveTo(begin, 0); ctx.lineTo(begin, canvas.height);
                spectrum.moveTo(begin, 0); spectrum.lineTo(begin, spectrumHeight);
                ctx.stroke(); spectrum.stroke();
            }
            if (end >= 0 && end < canvas.width) {       // 画右边
                ctx.beginPath(); spectrum.beginPath();
                ctx.strokeStyle = spectrum.strokeStyle = '#ff2020';
                ctx.moveTo(end, 0); ctx.lineTo(end, canvas.height);
                spectrum.moveTo(end, 0); spectrum.lineTo(end, spectrumHeight);
                ctx.stroke(); spectrum.stroke();
            }
            // 画区间 如果begin>end则区间不起作用，不绘制
            if (begin < end) {
                begin = Math.max(begin + 1, 0); end = Math.min(end - 1, canvas.width);
                ctx.fillStyle = spectrum.fillStyle = '#80808044';
                ctx.fillRect(begin, 0, end - begin, canvas.height);
                spectrum.fillRect(begin, 0, end - begin, spectrumHeight);
            }
            //== 画当前时间指针 ==//
            spectrum.strokeStyle = 'white';
            begin = this.time / this.dt * this._width - this.scrollX;
            if (begin >= 0 && begin < canvas.width) {
                spectrum.beginPath();
                spectrum.moveTo(begin, 0);
                spectrum.lineTo(begin, spectrumHeight);
                spectrum.stroke();
            }
        },
        updateInterval: () => {    // 根据this.width改变 在width的setter中调用
            const fontWidth = this.timeBar.ctx.measureText('00:00:000').width * 1.2;
            // 如果间距小于fontWidth则细分
            this.TimeBar.interval = Math.max(1, Math.ceil(fontWidth / this._width));
        },
        contextMenu: new ContextMenu([
            {
                name: "设置重复区间开始位置",
                callback: (e_father, e_self) => {
                    this.TimeBar.repeatStart = (e_father.offsetX + this.scrollX) * this.TperP;
                }
            }, {
                name: "设置重复区间结束位置",
                callback: (e_father, e_self) => {
                    this.TimeBar.repeatEnd = (e_father.offsetX + this.scrollX) * this.TperP;
                }
            }, {
                name: "取消重复区间",
                onshow: () => this.TimeBar.repeatStart >= 0 || this.TimeBar.repeatEnd >= 0,
                callback: () => {
                    this.TimeBar.repeatStart = -1;
                    this.TimeBar.repeatEnd = -1;
                }
            }, {
                name: "从此处播放",
                callback: (e_father, e_self) => {
                    this.AudioPlayer.stop();
                    this.AudioPlayer.start((e_father.offsetX + this.scrollX) * this.TperP);
                }
            }
        ])
    };
    this.BeatBar = {
        beats: new Beats(),
        update: () => {
            const canvas = this.timeBar;
            const ctx = this.timeBar.ctx;

            ctx.fillStyle = '#2e3039';
            const h = canvas.height >> 1;
            ctx.fillRect(0, h, canvas.width, canvas.width);
            ctx.fillStyle = '#8e95a6';
            const spectrum = this.spectrum.ctx;
            const spectrumHeight = this.spectrum.height;
            ctx.strokeStyle = '#f0f0f0f0';

            const iterator = this.BeatBar.beats.iterator(this.scrollX * this.TperP, true);
            ctx.beginPath(); spectrum.beginPath();
            while (1) {
                let measure = iterator.next();
                if (measure.done) break;
                measure = measure.value;
                let x = measure.start * this.PperT - this.scrollX;
                if (x > canvas.width) break;
                ctx.moveTo(x, h);
                ctx.lineTo(x, canvas.height);
                spectrum.strokeStyle = '#a0a0a0';
                spectrum.moveTo(x, 0);
                spectrum.lineTo(x, spectrumHeight);
                // 写字
                let Interval = measure.interval * this.PperT;
                ctx.fillText(Interval < 38 ? measure.id : `${measure.id}. ${measure.beatNum}/${measure.beatUnit}`, x + 2, h + 14);
                // 画更细的节拍线
                let dp = Interval / measure.beatNum;
                if (dp < 20) continue;
                spectrum.strokeStyle = '#909090';
                for (let i = measure.beatNum; i > 0; i--, x += dp) {
                    spectrum.moveTo(x, 0);
                    spectrum.lineTo(x, spectrumHeight);
                }
            } ctx.stroke(); spectrum.stroke();
        },
        contextMenu: new ContextMenu([
            {
                name: "设置小节",
                callback: (e_father, e_self) => {
                    const bs = this.BeatBar.beats;
                    const m = bs.setMeasure((e_father.offsetX + this.scrollX) * this.TperP, undefined, true);
                    let tempDiv = document.createElement('div');
                    tempDiv.innerHTML = `
    <div class="request-cover">
        <div class="card hvCenter"><label class="title">小节${m.id}设置</label>
            <div class="layout"><span>拍数</span><input type="text" name="ui-ask" step="1" max="16" min="1"></div>
            <div class="layout"><span>音符</span><select name="ui-ask">
                <option value="2">2分</option>
                <option value="4">4分</option>
                <option value="8">8分</option>
                <option value="16">16分</option>
            </select></div>
            <div class="layout"><span>BPM:</span><input type="number" name="ui-ask" min="1"></div>
            <div class="layout"><span>(忽略以上)和上一小节一样</span><input type="checkbox" name="ui-ask"></div>
            <div class="layout"><span>应用到后面相邻同类型小节</span><input type="checkbox" name="ui-ask" checked></div>
            <div class="layout"><button class="ui-cancel">取消</button><button class="ui-confirm">确定</button></div>
        </div>
    </div>`;
                    const Pannel = tempDiv.firstElementChild;
                    document.body.insertBefore(Pannel, document.body.firstChild);
                    Pannel.tabIndex = 0;
                    Pannel.focus();
                    function close() { Pannel.remove(); }
                    const inputs = Pannel.querySelectorAll('[name="ui-ask"]');
                    const btns = Pannel.getElementsByTagName('button');
                    inputs[0].value = m.beatNum;    // 拍数
                    inputs[1].value = m.beatUnit;   // 音符类型
                    inputs[2].value = m.bpm;        // bpm
                    btns[0].onclick = close;
                    btns[1].onclick = () => {
                        if (!inputs[4].checked) {     // 后面不变
                            bs.setMeasure(m.id + 1, false); // 让下一个生成实体
                        }
                        if (inputs[3].checked) {     // 和上一小节一样
                            let last = bs.getMeasure(m.id - 1, false);
                            m.copy(last);
                        } else {
                            m.beatNum = parseInt(inputs[0].value);
                            m.beatUnit = parseInt(inputs[1].value);
                            m.bpm = parseInt(inputs[2].value);
                        } bs.check(); close();
                    };
                }
            }, {
                name: "后方插入一小节",
                callback: (e_father) => {
                    this.BeatBar.beats.add((e_father.offsetX + this.scrollX) * this.TperP, true);
                }
            }, {
                name: "重置后面所有小节",
                callback: (e_father) => {
                    let base = this.BeatBar.beats.getBaseIndex((e_father.offsetX + this.scrollX) * this.TperP, true);
                    this.BeatBar.beats.splice(base + 1);
                }
            }, {
                name: '<span style="color: red;">删除该小节</span>',
                callback: (e_father, e_self) => {
                    this.BeatBar.beats.delete((e_father.offsetX + this.scrollX) * this.TperP, true);
                }
            }
        ]),
        belongID: -1,   // 小节线前一个小节的id
        moveCatch: (e) => {     // 画布上光标移动到小节线上可以进入调整模式
            if (e.offsetY < this.timeBar.height >> 1) {
                this.timeBar.classList.remove('selecting');
                this.BeatBar.belongID = -1;
                return;
            }
            let timeNow = (e.offsetX + this.scrollX) * this.TperP;
            let m = this.BeatBar.beats.getMeasure(timeNow, true);
            if (m == null) {
                this.BeatBar.belongID = -1;
                this.timeBar.classList.remove('selecting');
                return;
            }
            let threshold = 6 * this.TperP;
            if (timeNow - m.start < threshold) {
                this.BeatBar.belongID = m.id - 1;
                this.timeBar.classList.add('selecting');
            } else if (m.start + m.interval - timeNow < threshold) {
                this.BeatBar.belongID = m.id;
                this.timeBar.classList.add('selecting');
            } else {
                this.BeatBar.belongID = -1;
                this.timeBar.classList.remove('selecting');
            }
        }
    };
    // 小插件对象
    this.pitchNameDisplay = {   // 音名显示 配合设置中的checkbox使用
        _showPitchName: null,
        showPitchName: (ifshow) => {
            if (ifshow) {
                this.spectrum.addEventListener('mousemove', this._trackMouseX);
                this.pitchNameDisplay._showPitchName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            } else {
                this.spectrum.removeEventListener('mousemove', this._trackMouseX);
                this.pitchNameDisplay._showPitchName = null;
            }
        },
        update: () => {
            if (this.pitchNameDisplay._showPitchName) {
                this.spectrum.ctx.fillStyle = 'black';
                this.spectrum.ctx.fillText(
                    this.pitchNameDisplay._showPitchName[this.Keyboard.highlight % 12],
                    this._mouseX - this._height,
                    this.spectrum.height - (this.Keyboard.highlight - 24) * this._height + this.scrollY - (this._height >> 3));
            }
        }
    };
    // 撤销相关
    this.snapshot = new Snapshot(16, {
        midi: JSON.stringify(this.MidiAction.midi),     // 音符移动、长度改变、channel改变后
        channel: JSON.stringify(this.MidiAction.channelDiv.channel), // 音轨改变序号、增删、修改参数后
        beat: JSON.stringify(this.BeatBar.beats)
    });
    this.snapshot.save = () => {
        this.snapshot.add({
            channel: JSON.stringify(this.MidiAction.channelDiv.channel),
            midi: JSON.stringify(this.MidiAction.midi),
            beat: JSON.stringify(this.BeatBar.beats)
        });
    };
    this.HscrollBar = {     // 配合scroll的滑动条
        track: document.getElementById('scrollbar-track'),
        thumb: document.getElementById('scrollbar-thumb'),
        thumbMousedown: (event) => {    // 滑块跟随鼠标
            event.stopPropagation();    // 防止触发track的mousedown
            const startX = event.clientX;
            const thumb = this.HscrollBar.thumb;
            const track = this.HscrollBar.track;
            const thumbLeft = thumb.offsetLeft;
            const moveThumb = (event) => {
                let currentX = event.clientX - startX + thumbLeft;
                let maxThumbLeft = track.offsetWidth - thumb.offsetWidth;
                let maxScrollX = this._width * this._xnum - this.spectrum.width;
                this.scroll2(currentX / maxThumbLeft * maxScrollX, this.scrollY);
            }
            const stopMoveThumb = () => {
                document.removeEventListener("mousemove", moveThumb);
                document.removeEventListener("mouseup", stopMoveThumb);
            }
            document.addEventListener("mousemove", moveThumb);
            document.addEventListener("mouseup", stopMoveThumb);
        },
        trackMousedown: (e) => {    // 滑块跳转
            e.stopPropagation();
            const thumb = this.HscrollBar.thumb;
            const track = this.HscrollBar.track;
            let maxScrollX = this._width * this._xnum - this.spectrum.width;
            let maxThumbLeft = track.offsetWidth - thumb.offsetWidth;
            let p = (e.offsetX - (thumb.offsetWidth >> 1)) / maxThumbLeft;  // nnd 减法优先级比位运算高
            this.scroll2(p * maxScrollX, this.scrollY);
        },
        refreshPosition: () => {
            let all = this._width * this._xnum - this.spectrum.width;
            let pos = (this.HscrollBar.track.offsetWidth - this.HscrollBar.thumb.offsetWidth) * this.scrollX / all;
            this.HscrollBar.thumb.style.left = pos + 'px';
        },
        refreshSize: () => {    // 需要在this.xnum this.width改变之后调用 在二者的setter中调用
            this.HscrollBar.track.style.display = 'block';
            let p = Math.min(1, this.spectrum.width / (this._width * this._xnum));   // 由于有min存在所以xnum即使为零也能工作
            let nw = p * this.HscrollBar.track.offsetWidth;
            this.HscrollBar.thumb.style.width = Math.max(nw, 10) + 'px';    // 限制最小宽度
        }
    };
    this._copy = '';  // 用于复制音符 会是JSON字符串
    this.shortcutActions = {    // 快捷键动作
        'Ctrl+Z': () => {   // 撤销
            let lastState = this.snapshot.undo();
            if (!lastState) return;
            this.MidiAction.midi = JSON.parse(lastState.midi);
            this.MidiAction.selected = this.MidiAction.midi.filter((obj) => obj.selected);
            this.MidiAction.channelDiv.fromArray(JSON.parse(lastState.channel));
            this.BeatBar.beats.copy(JSON.parse(lastState.beat));
            this.MidiAction.updateView();
        },
        'Ctrl+Y': () => {
            let nextState = this.snapshot.redo();
            if (!nextState) return;
            this.MidiAction.midi = JSON.parse(nextState.midi);
            this.MidiAction.selected = this.MidiAction.midi.filter((obj) => obj.selected);
            this.MidiAction.channelDiv.fromArray(JSON.parse(nextState.channel));
            this.BeatBar.beats.copy(JSON.parse(nextState.beat));
            this.MidiAction.updateView();
        },
        'Ctrl+A': () => {           // 选中该通道的所有音符
            let ch = this.MidiAction.channelDiv.selected;
            if (ch) {
                ch = ch.index;
                this.MidiAction.midi.forEach((note) => {
                    note.selected = note.ch == ch;
                });
                this.MidiAction.selected = this.MidiAction.midi.filter((nt) => nt.selected);
            } else this.shortcutActions['Ctrl+Shift+A']();
        },
        'Ctrl+Shift+A': () => {     // 真正意义上的全选
            this.MidiAction.midi.forEach((note) => {
                note.selected = true;
            });
            this.MidiAction.selected = [...this.MidiAction.midi];
        },
        'Ctrl+D': () => {           // 取消选中
            this.MidiAction.clearSelected();
        },
        'Ctrl+C': () => {
            if (this.MidiAction.selected.length == 0) return;
            this._copy = JSON.stringify(this.MidiAction.selected);
        },
        'Ctrl+X': () => {
            if (this.MidiAction.selected.length == 0) return;
            this._copy = JSON.stringify(this.MidiAction.selected);
            this.MidiAction.deleteNote();   // deleteNote会更新view和存档
        },
        'Ctrl+V': () => {
            if (!this._copy) return;    // 空字符串或null
            const ch = this.MidiAction.channelDiv.selected;
            if (!ch) { alert("请先选择一个音轨!"); return; }
            let chid = ch.index;
            let copy = JSON.parse(this._copy);
            // 找到第一个
            let minX = Infinity;
            copy.forEach((note) => {
                note.ch = chid;
                note.selected = true;
                if (note.x1 < minX) minX = note.x1;
            });
            this.MidiAction.clearSelected();
            this.MidiAction.selected = copy;
            // 粘贴到光标位置
            minX = (this.time / this.dt - minX) | 0;
            copy.forEach((note) => {
                note.x1 += minX;
                note.x2 += minX;
            });
            this.MidiAction.midi.push(...copy);
            this.MidiAction.midi.sort((a, b) => a.x1 - b.x1);
            this.MidiAction.updateView();
            this.snapshot.save();
        },
        'Ctrl+B': () => {       // 收回面板
            const channelDiv = this.MidiAction.channelDiv.container.parentNode;
            if (channelDiv.style.display == 'none') {
                channelDiv.style.display = 'block';
            } else {
                channelDiv.style.display = 'none';
            } this.resize();
        }
    };
    /**
     * 改变工作区(频谱、键盘、时间轴)大小
     * @param {Number} w 工作区的新宽度 默认充满父容器
     * @param {Number} h 工作区的新高度 默认充满父容器
     * 充满父容器，父容器需设置flex:1;overflow:hidden;
     */
    this.resize = (w = undefined, h = undefined) => {
        const box = document.getElementById('Canvases-Container').getBoundingClientRect();
        w = w || box.width;
        h = h || box.height;
        if (w > 80) {
            this.spectrum.width = w - 80;
            this.keyboard.width = 80;
        } else {
            this.spectrum.width = 0.4 * w;
            this.keyboard.width = 0.6 * w;
        }
        if (h > 40) {
            this.spectrum.height = h - 40;
            this.timeBar.height = 40;
        } else {
            this.spectrum.height = 0.4 * h;
            this.timeBar.height = 0.6 * h;
        }
        this.keyboard.height = this.spectrum.height;
        this.timeBar.width = this.spectrum.width;
        document.getElementById('play-btn').style.width = this.keyboard.width + 'px';
        // 改变画布长宽之后，设置的值会重置，需要重新设置
        this.spectrum.ctx.lineWidth = 1; this.spectrum.ctx.font = `${this._height}px Arial`;
        this.keyboard.ctx.lineWidth = 1; this.keyboard.ctx.font = `${this._height + 2}px Arial`;
        this.timeBar.ctx.font = '14px Arial';
        // 更新滑动条大小
        this.width = this._width;   // 除了触发滑动条更新，还能在初始化的时候保证timeBar的文字间隔
        this.scroll2();
    };
    /**
     * 移动到 scroll to (x, y)
     * 由目标位置得到合法的scrollX和scrollY，并更新XY方向的scroll离散值起点(序号)
     * @param {Number} x 新视野左边和世界左边的距离
     * @param {Number} y 新视野下边和世界下边的距离
     */
    this.scroll2 = (x = this.scrollX, y = this.scrollY) => {
        this.scrollX = Math.max(0, Math.min(x, this._width * this._xnum - this.spectrum.width));
        this.scrollY = Math.max(0, Math.min(y, this._height * this.ynum - this.spectrum.height));
        this.idXstart = (this.scrollX / this._width) | 0;
        this.idYstart = (this.scrollY / this._height) | 0;
        this.idXend = Math.min(this._xnum, Math.ceil((this.scrollX + this.spectrum.width) / this._width));
        this.idYend = Math.min(this.ynum, Math.ceil((this.scrollY + this.spectrum.height) / this._height));
        this.rectXstart = this.idXstart * this._width - this.scrollX;
        this.rectYstart = this.spectrum.height - this.idYstart * this._height + this.scrollY;   // 画图的y从左上角开始
        // 滑动条
        this.HscrollBar.refreshPosition();
        this.MidiAction.updateView();
    };
    /**
     * 按倍数横向缩放时频图 以鼠标指针为中心
     * @param {Number} mouseX 
     * @param {Number} times 倍数 比用加减像素好，更连续
     */
    this.scaleX = (mouseX, times) => {
        let nw = this._width * times;
        if (nw < 2) return;
        if (nw > this.spectrum.width >> 2) return;
        this.width = nw;
        this.scroll2((this.scrollX + mouseX) * times - mouseX, this.scrollY);
    };
    /**
     * 重新绘制画布(工作区)
     */
    this.update = () => {
        // 首先要同步时间 如果音频播放了，就同步音频时间
        this.AudioPlayer.update();
        this.MidiPlayer.update();
        this.Spectrogram.update();
        this.BeatBar.update();
        this.Keyboard.update();
        this.MidiAction.update();
        this.TimeBar.update();  // 必须在Spectrogram后更新，因为涉及时间指示的绘制
        this.pitchNameDisplay.update();
    };
    this.trackMouseY = (e) => { // onmousemove
        this.mouseY = e.offsetY;
    };
    this.trackMouseX = (e) => {     // 用于框选，会更新frameX值
        this.mouseX = e.offsetX;
    };
    this._trackMouseX = (e) => {    // 给this.Spectrogram.showPitchName专用的，只会更新_mouseX
        this._mouseX = e.offsetX;
    };
    /**
     * 动画循环绘制
     * @param {Boolean} loop 是否开启循环
     */
    this.loopUpdate = (loop = true) => {
        if (loop) {
            const update = (t) => {
                this.update();
                this.loop = requestAnimationFrame(update);
            };  // 必须用箭头函数包裹，以固定this的指向
            this.loop = requestAnimationFrame(update);
        } else {
            cancelAnimationFrame(this.loop);
        }
    };
    //=========数据解析相关=========//
    this.Analyser = {
        /**
         * 对audioBuffer执行STFT
         * @param {AudioBuffer} audioBuffer 音频缓冲区
         * @param {Number} tNum 一秒几次分析 决定步距
         * @param {Number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
         * @param {Number} fftPoints 实数fft点数
         * @returns {Array<Float32Array>} 时频谱数据
         */
        analyse: async (audioBuffer, tNum = 20, A4 = 440, channel = -1, fftPoints = 8192) => {
            this.dt = 1000 / tNum;
            this.TperP = this.dt / this._width; this.PperT = this._width / this.dt;
            let dN = Math.round(audioBuffer.sampleRate / tNum);
            if (this.Keyboard.freqTable.A4 != A4) this.Keyboard.freqTable.A4 = A4;   // 更新频率表
            let progressTrans = (x) => x;   // 如果分阶段执行则需要自定义进度的变换

            // 创建分析工具
            var fft = new realFFT(fftPoints); // 8192点在44100采样率下，最低能分辨F#2，但是足矣
            var analyser = new NoteAnalyser(audioBuffer.sampleRate / fftPoints, this.Keyboard.freqTable);

            const a = async (t) => { // 对t执行STFT，并整理为时频谱
                let nFinal = t.length - fftPoints;
                const result = new Array(((nFinal / dN) | 0) + 1);
                for (let n = 0, k = 0; n <= nFinal; n += dN) {
                    result[k++] = analyser.analyse(...fft.fft(t, n));
                    // 一帧一次也太慢了。这里固定更新帧率
                    let tnow = performance.now();
                    if (tnow - lastFrame > 200) {
                        lastFrame = tnow;
                        // 打断分析 更新UI 等待下一周期
                        this.event.dispatchEvent(new CustomEvent("progress", {
                            detail: progressTrans(k / (result.length - 1))
                        }));
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }   // 通知UI关闭的事件分发移到了audio.onloadeddata中
                return result;
            };

            await new Promise(resolve => setTimeout(resolve, 0));   // 等待UI
            var lastFrame = performance.now();
            switch (channel) {
                case 0: return await a(audioBuffer.getChannelData(0));
                case 1: return await a(audioBuffer.getChannelData(audioBuffer.numberOfChannels - 1));
                case 2: {   // L+R
                    let length = audioBuffer.length;
                    const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                    if (audioBuffer.numberOfChannels > 1) {
                        let channelData = audioBuffer.getChannelData(1);
                        for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] + channelData[i]) * 0.5;
                    } return await a(timeDomain);
                }
                case 3: {   // L-R
                    let length = audioBuffer.length;
                    const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                    if (audioBuffer.numberOfChannels > 1) {
                        let channelData = audioBuffer.getChannelData(1);
                        for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] - channelData[i]) * 0.5;
                    } return await a(timeDomain);
                }
                default: {  // fft(L) + fft(R)
                    if (audioBuffer.numberOfChannels > 1) {
                        progressTrans = (x) => x / 2;
                        const l = await a(audioBuffer.getChannelData(0));
                        progressTrans = (x) => 0.5 + x / 2;
                        const r = await a(audioBuffer.getChannelData(1));
                        for (let i = 0; i < l.length; i++) {
                            const li = l[i];
                            for (let j = 0; j < li.length; j++)
                                li[j] = (li[j] + r[i][j]) * 0.5;
                        } return l;
                    } else {
                        progressTrans = (x) => x;
                        return await a(audioBuffer.getChannelData(0));
                    }
                }
            }
        },
        onfile: (file) => {     // 依赖askUI.css
            let midimode = file == void 0;  // 在确认后才能this.midiMode=midimode
            if (midimode) {      // 不传则说明是midi编辑器模式
                file = { name: "MIDI编辑器模式" };
            } else if (!(file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
                this.event.dispatchEvent(new Event('fileerror'));
                return;
            }
            if (this.Spectrogram._spectrogram && !confirm("本页面已加载音频，是否替换？")) {
                return;
            }
            this.event.dispatchEvent(new Event('fileui'));
            let tempDiv = document.createElement('div');
            // 为了不影响下面的事件绑定，midi模式下用display隐藏
            tempDiv.innerHTML = `
            <div class="request-cover">
                <div class="card hvCenter"><label class="title">${file.name}</label>&nbsp;&nbsp;<button class="ui-cancel"${midimode ? ' style="display:none;"' : ''}>使用已有结果</button>
                    <div class="layout"><span>每秒的次数：</span><input type="number" name="ui-ask" value="20" min="1" max="100"></div>
                    <div class="layout"><span>标准频率A4=</span><input type="number" name="ui-ask" value="440" step="0.1" min="55"></div>
                    <div class="layout"${midimode ? ' style="display:none;"' : ''}>分析声道：</div>
                    <div class="layout"${midimode ? ' style="display:none;"' : ''}>
                        <input type="radio" name="ui-ask" value="4" checked>Stereo
                        <input type="radio" name="ui-ask" value="2">L+R
                        <input type="radio" name="ui-ask" value="3">L-R
                        <input type="radio" name="ui-ask" value="0">L
                        <input type="radio" name="ui-ask" value="1">R
                    </div>
                    <div class="layout"><button class="ui-cancel">取消</button><button class="ui-confirm">${midimode ? '确认' : '解析'}</button></div>
                </div>
            </div>`;
            this.AudioPlayer.name = file.name;
            const ui = tempDiv.firstElementChild;
            function close() { ui.remove(); }
            let btns = ui.getElementsByTagName('button');
            btns[0].onclick = () => {
                close();
                const input = document.createElement("input");
                input.type = "file";
                input.onchange = () => {
                    this.Saver.parse(input.files[0]).then((data) => {
                        // 再读取音频看看是否成功
                        const fileReader = new FileReader();
                        fileReader.onload = (e) => {
                            // 设置音频源 缓存到浏览器
                            this.AudioPlayer.createAudio(e.target.result).then(() => {
                                if (this.AudioPlayer.name != data[0].name &&
                                    !confirm(`音频文件与分析结果(${data[0].name})不同，是否继续？`))
                                    return;
                                this.Saver.import(data);
                            });
                        }; fileReader.readAsDataURL(file);
                    }).catch((e) => {
                        this.event.dispatchEvent(new Event('fileerror'));
                    });
                }; input.click();
            };
            btns[1].onclick = () => {
                close();
                this.event.dispatchEvent(new Event('filecancel'));  // 为了恢复drag功能
            };
            btns[2].onclick = () => {
                // 获取分析参数
                const params = ui.querySelectorAll('[name="ui-ask"]');  // getElementsByName只能在document中用
                let tNum = params[0].value;
                let A4 = params[1].value;
                let channel = 4;
                for (let i = 2; i < 7; i++) {
                    if (params[i].checked) {
                        channel = parseInt(params[i].value);
                        break;
                    }
                }
                close();
                this.midiMode = midimode;
                //==== midi模式 ====//
                if (midimode) {
                    // 在Anaylse中的设置全局的
                    this.dt = 1000 / tNum;
                    this.TperP = this.dt / this._width; this.PperT = this._width / this.dt;
                    if (this.Keyboard.freqTable.A4 != A4) this.Keyboard.freqTable.A4 = A4;
                    let l = Math.ceil((this.spectrum.width << 1) / this.width);   // 视野外还有一面
                    // 一个怎么取值都返回0的东西，充当频谱
                    this.Spectrogram.spectrogram = new Proxy({
                        parent: this,
                        spectrogram: new Uint8Array(this.ynum).fill(0),
                        _length: l,
                        get length() { return this._length; },
                        set length(l) { // 只要改变频谱的长度就可以改变时长 长度改变在MidiAction.updateView中
                            if (l < 0) return;
                            const p = this.parent;
                            this._length = p.xnum = l;
                            p.AudioPlayer.audio.duration = l / tNum;
                            p.AudioPlayer.play_btn.lastChild.textContent = p.AudioPlayer.durationString;
                        }
                    }, {
                        get(obj, prop) {    // 方括号传递的总是string
                            if (isNaN(Number(prop))) return obj[prop];
                            return obj.spectrogram;
                        },
                        set(obj, prop, value) {
                            if (isNaN(Number(prop))) obj[prop] = value;
                        }
                    });
                    // 假音频 需要设置this.midiMode=true;
                    this.AudioPlayer.createAudio(l / tNum);
                    return;
                }
                //==== 音频文件分析 ====//
                this.event.dispatchEvent(new Event('fileaccept'));
                // 打开另一个ui analyse加入回调以显示进度
                let tempDiv = document.createElement('div');
                tempDiv.innerHTML = `
                <div class="request-cover">
                    <div class="card hvCenter"><label class="title">解析中</label>
                        <span>00%</span>
                        <div class="layout">
                            <div class="porgress-track">
                                <div class="porgress-value"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
                const progressUI = tempDiv.firstElementChild;
                const progress = progressUI.querySelector('.porgress-value');
                const percent = progressUI.querySelector('span');
                document.body.insertBefore(progressUI, document.body.firstChild);
                const onprogress = ({ detail }) => {
                    if (detail < 0) {
                        this.event.removeEventListener('progress', onprogress);
                        progress.style.width = '100%';
                        percent.textContent = '100%';
                        progressUI.style.opacity = 0;
                        setTimeout(() => progressUI.remove(), 200);
                    } else if (detail >= 1) {
                        detail = 1;
                        progress.style.width = '100%';
                        percent.textContent = "加载界面……";
                    } else {
                        progress.style.width = (detail * 100) + '%';
                        percent.textContent = (detail * 100).toFixed(2) + '%';
                    }
                };
                this.event.addEventListener('progress', onprogress);
                // 读取文件
                let audioData;
                const fileReader = new FileReader();
                fileReader.onload = (e) => {
                    // 解码音频文件为音频缓冲区
                    this.audioContext.decodeAudioData(e.target.result).then((decodedData) => {
                        audioData = decodedData;
                        return Promise.all([
                            this.Analyser.analyse(decodedData, tNum, A4, channel, 8192),
                            this.AudioPlayer.createAudio(URL.createObjectURL(file)) // fileReader.readAsDataURL(file) 将mov文件decode之后变成base64，audio无法播放 故不用
                        ]);
                    }).then(([v, audio]) => {
                        this.Spectrogram.spectrogram = v;
                    }).catch((e) => {
                        alert(e); console.error(e);
                        this.event.dispatchEvent(new Event('fileerror'));
                    }).finally(() => {
                        // 最终都要关闭进度条
                        this.event.dispatchEvent(new CustomEvent('progress', { detail: -1 }));
                        // 后台执行CQT
                        if (window.location.protocol == 'file:' || window.cqt == undefined) return;    // 开worker和fetch要求http
                        console.time("CQT计算");
                        cqt(audioData, tNum, channel, this.Keyboard.freqTable[0]).then((cqtData) => {
                            // CQT结果准确但琐碎，STFT结果粗糙但平滑，所以混合一下
                            const s = this.Spectrogram.spectrogram;
                            let tLen = Math.min(cqtData.length, s.length);
                            for (let i = 0; i < tLen; i++) {
                                const cqtBins = cqtData[i];
                                const stftBins = s[i];
                                for (let j = 0; j < cqtBins.length; j++) {
                                    // 用非线性混合，当两者极大的时候取最大值，否则相互压制
                                    if(stftBins[j] < cqtBins[j]) stftBins[j] = cqtBins[j];
                                    else stftBins[j] = Math.sqrt(stftBins[j] * cqtBins[j]);
                                }
                            }
                            console.timeEnd("CQT计算");
                        }).catch(console.error);
                    });
                }; fileReader.readAsArrayBuffer(file);
            };
            document.body.insertBefore(ui, document.body.firstChild);   // 插入body的最前面
        }
    };
    //========= 导入导出 =========//
    if (window.bSaver) this.Saver = {
        export: () => {
            if (!this.Spectrogram._spectrogram) return null;
            const data = {
                midi: this.MidiAction.midi,
                channel: this.MidiAction.channelDiv.channel,
                beat: this.BeatBar.beats,
                dt: this.dt,
                A4: this.Keyboard.freqTable.A4,
                name: this.AudioPlayer.name
            }; return [data, this.Spectrogram._spectrogram];
        },
        import: (data) => {
            const obj = data[0];
            this.MidiAction.midi = obj.midi;
            this.MidiAction.selected = this.MidiAction.midi.filter((obj) => obj.selected);
            this.MidiAction.channelDiv.fromArray(obj.channel);
            this.BeatBar.beats.copy(obj.beat);
            this.dt = obj.dt;
            this.Keyboard.freqTable.A4 = obj.A4;
            this.Spectrogram.spectrogram = data[1];
            this.snapshot.save();
        },
        write: (fileName = this.AudioPlayer.name) => {
            const data = this.Saver.export();
            bSaver.saveArrayBuffer(bSaver.combineArrayBuffers([
                bSaver.String2Buffer("noteDigger"),
                bSaver.Object2Buffer(data[0]),
                bSaver.Float32Mat2Buffer(data[1])
            ]), fileName + '.nd');
        },
        parse: (file) => {
            return new Promise((resolve, reject) => {
                bSaver.readBinary(file, (b) => {
                    let [name, o] = bSaver.Buffer2String(b, 0);
                    if (name != "noteDigger") {
                        reject(new Error("incompatible file!"));
                        return;
                    }
                    let [obj, o1] = bSaver.Buffer2Object(b, o);
                    let [f32, _] = bSaver.Buffer2Float32Mat(b, o1);
                    resolve([obj, f32]);
                });
            });
        }
    };
    //========= 事件注册 =========//
    document.getElementById('speedControl').addEventListener('input', (e) => { // 变速
        this.AudioPlayer.audio.playbackRate = parseFloat(e.target.value);
    });
    document.getElementById('multiControl').addEventListener('input', (e) => { // 变画频谱的倍率
        this.Spectrogram.multiple = parseFloat(e.target.value);
    });
    document.getElementById('midivolumeControl').addEventListener('input', (e) => { // midi音量
        this.synthesizer.out.gain.value = parseFloat(e.target.value) ** 2;
    });
    document.getElementById('audiovolumeControl').addEventListener('input', (e) => {// 音频音量
        this.AudioPlayer.audio.volume = parseFloat(e.target.value);
    });
    document.addEventListener('keydown', (e) => { // 键盘事件
        // 以下在没有频谱数据时不启用……【目前的实现是补丁。之后视情况升级：在获取到频谱数据后注册事件回调】
        if (!this.Spectrogram._spectrogram) return;
        let shortcut = '';
        if (e.ctrlKey) shortcut += 'Ctrl+';  // Ctrl优先
        if (e.shiftKey) shortcut += 'Shift+';
        if (e.altKey) shortcut += 'Alt+';
        if (shortcut != '') {   // 组合键
            shortcut += e.key.toUpperCase();    // 大小写一视同仁
            if (this.shortcutActions.hasOwnProperty(shortcut)) {
                e.preventDefault(); // 阻止默认的快捷键行为
                this.shortcutActions[shortcut]();
            }
        } else {                // 单个按键
            switch (e.key) {
                case 'ArrowUp': this.scroll2(this.scrollX, this.scrollY + this._height); break;
                case 'ArrowDown': this.scroll2(this.scrollX, this.scrollY - this._height); break;
                case 'ArrowLeft': this.scroll2(this.scrollX - this._width, this.scrollY); break;
                case 'ArrowRight': this.scroll2(this.scrollX + this._width, this.scrollY); break;
                case 'Delete': this.MidiAction.deleteNote(); break;
                case ' ': this.AudioPlayer.play_btn.click(); break;
            }
        }
    });
    // audio可以后台播放，但是requestAnimationFrame不行，而时间同步在requestAnimationFrame中
    // 还有一个办法：在可见状态变化时，将update绑定到audio.ontimeupdate上，但是这个事件触发频率很低，而预测器根据60帧设计的
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.AudioPlayer.stop();
    });
    this.AudioPlayer.play_btn.onclick = () => {
        if (this.AudioPlayer.audio.paused) this.AudioPlayer.start(-1);
        else this.AudioPlayer.stop();
        this.AudioPlayer.play_btn.blur();   // 防止焦点在按钮上导致空格响应失败
    };
    window.addEventListener('load', () => { this.resize(); });
    window.addEventListener('resize', () => { this.resize(); });
    this.HscrollBar.thumb.addEventListener('mousedown', this.HscrollBar.thumbMousedown);
    this.HscrollBar.track.addEventListener('mousedown', this.HscrollBar.trackMousedown);
    this.spectrum.addEventListener('wheel', (e) => {
        // e.deltaY 往前滚是负数
        if (e.ctrlKey) {    // 缩放
            e.preventDefault();
            this.scaleX(e.offsetX, e.deltaY > 0 ? 1.25 : 0.8);
        } else if (e.shiftKey) { // 垂直滚动
            // 只有鼠标滚轮时是有deltaY。所以这里让X方向能移动，做法是交换X和Y
            this.scroll2(this.scrollX + e.deltaY, this.scrollY + e.deltaX);
        } else {    // 触摸板的滑动也是wheel
            this.scroll2(this.scrollX + e.deltaX, this.scrollY - e.deltaY);
        }   // 只改状态，但不绘图。绘图交给固定时间刷新完成
        this.trackMouseY(e);
    });
    this.spectrum.contextMenu = new ContextMenu([
        {
            name: "撤销", callback: () => {
                this.shortcutActions['Ctrl+Z']();
            }, onshow: () => this.Spectrogram._spectrogram && this.snapshot.lastState()
        }, {
            name: "重做", callback: () => {
                this.shortcutActions['Ctrl+Y']();
            }, onshow: () => this.Spectrogram._spectrogram && this.snapshot.nextState()
        }, {
            name: "粘贴", callback: () => {
                this.shortcutActions['Ctrl+V']();
            }, onshow: () => this.Spectrogram._spectrogram && this._copy != ''
        }, {
            name: "复制", callback: () => {
                this.shortcutActions['Ctrl+C']();
            }, onshow: () => this.Spectrogram._spectrogram && this.MidiAction.selected.length > 0
        }, {
            name: "反选", callback: () => {
                let ch = this.MidiAction.channelDiv.selected;
                let id = ch && ch.index;
                ch = !ch;
                for (const nt of this.MidiAction.midi)
                    nt.selected = (ch || nt.ch == id) && !nt.selected;
                this.MidiAction.selected = this.MidiAction.midi.filter(nt => nt.selected);
            }, onshow: () => this.Spectrogram._spectrogram
        }, {
            name: '<span style="color: red;">删除</span>', callback: () => {
                this.MidiAction.deleteNote();
            }, onshow: () => this.Spectrogram._spectrogram && this.MidiAction.selected.length > 0
        }
    ]);
    this.spectrum.addEventListener('mousedown', (e) => {
        if (e.button == 1) {    // 中键按下 动作同触摸板滑动 视窗移动
            const moveWindow = (e) => {
                this.scroll2(this.scrollX - e.movementX, this.scrollY + e.movementY);
            }; this.spectrum.addEventListener('mousemove', moveWindow);
            const up = () => {
                this.spectrum.removeEventListener('mousemove', moveWindow);
                document.removeEventListener('mouseup', up);
            }; document.addEventListener('mouseup', up);
            return;
        }
        // 以下在没有频谱数据时不启用
        if (this.Spectrogram._spectrogram) {
            if (e.button == 0) this.MidiAction.onclick_L(e);    // midi音符相关
            else if (e.button == 2 && e.shiftKey) {
                this.spectrum.contextMenu.show(e);
                e.stopPropagation();
            } else this.MidiAction.clearSelected();    // 取消音符选中
        } this.Keyboard.mousedown();    // 将发声放到后面，因为onclick_L会改变选中的音轨
    });
    this.spectrum.addEventListener('mousemove', this.trackMouseY);
    this.spectrum.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    this.timeBar.addEventListener('dblclick', (e) => {
        if (this.AudioPlayer.audio.readyState != 4) return;
        this.AudioPlayer.stop();
        let position = (e.offsetX + this.scrollX) * this.AudioPlayer.audio.duration / (this._xnum * this._width)
        this.AudioPlayer.start(position * 1000);
    });
    this.timeBar.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // 右键菜单
        if (e.offsetY < this.timeBar.height >> 1) this.TimeBar.contextMenu.show(e);
        else this.BeatBar.contextMenu.show(e);
        e.stopPropagation();
    });
    this.timeBar.addEventListener('mousemove', this.BeatBar.moveCatch);
    this.timeBar.addEventListener('mousedown', (e) => {
        switch (e.button) {
            case 0:
                if (this.BeatBar.belongID > -1) {
                    let _anyAction = false;     // 是否存档
                    this.timeBar.removeEventListener('mousemove', this.BeatBar.moveCatch);
                    let m = this.BeatBar.beats.setMeasure(this.BeatBar.belongID, false);
                    let startAt = m.start * this.PperT;
                    let setMeasure = (e2) => {
                        _anyAction = true;
                        m.interval = Math.max(100, (e2.offsetX + this.scrollX - startAt) * this.TperP);
                        this.BeatBar.beats.check();
                    };
                    let removeEvents = () => {
                        this.timeBar.removeEventListener('mousemove', setMeasure);
                        this.timeBar.addEventListener('mousemove', this.BeatBar.moveCatch);
                        document.removeEventListener('mouseup', removeEvents);
                        if (_anyAction) this.snapshot.save();
                    };
                    this.timeBar.addEventListener('mousemove', setMeasure);
                    document.addEventListener('mouseup', removeEvents);
                } else {
                    const x = (e.offsetX + this.scrollX) / this._width * this.dt;    // 毫秒数
                    let setRepeat = (e) => {
                        let newX = (e.offsetX + this.scrollX) / this._width * this.dt;
                        if (newX > x) {
                            this.TimeBar.repeatStart = x;
                            this.TimeBar.repeatEnd = newX;
                        } else {
                            this.TimeBar.repeatEnd = x;
                            this.TimeBar.repeatStart = newX;
                        }
                    };
                    let removeEvents = () => {
                        this.timeBar.removeEventListener('mousemove', setRepeat);
                        document.removeEventListener('mouseup', removeEvents);
                    };
                    this.timeBar.addEventListener('mousemove', setRepeat);
                    document.addEventListener('mouseup', removeEvents);
                }
                break;
            case 1:     // 中键跳转位置但不改变播放状态
                this.time = (e.offsetX + this.scrollX) / this._width * this.dt;
                this.AudioPlayer.audio.currentTime = this.time / 1000;
                this.AudioPlayer.play_btn.firstChild.textContent = this.TimeBar.msToClockString(this.time);
                break;
        }
    });
    this.keyboard.addEventListener('wheel', (e) => {
        this.scroll2(this.scrollX, this.scrollY - e.deltaY);    // 只能上下移动
    });
    this.keyboard.addEventListener('mousemove', this.trackMouseY);
    this.keyboard.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    this.keyboard.addEventListener('mousedown', (e) => {
        if (e.button == 1) {    // 中键按下 动作同触摸板滑动 视窗移动
            const moveWindow = (e) => {
                this.scroll2(this.scrollX, this.scrollY + e.movementY);
            }; this.keyboard.addEventListener('mousemove', moveWindow);
            const up = () => {
                this.keyboard.removeEventListener('mousemove', moveWindow);
                document.removeEventListener('mouseup', up);
            }; document.addEventListener('mouseup', up);
            return;
        } this.Keyboard.mousedown();
    });
    this.loopUpdate(true);
}
/*
需要什么dom?
#Canvases-Container div 决定画布高度
#spectrum canvas 画频谱
#piano canvas 画琴键
#timeBar canvas 画时间轴
#funcSider div 音轨选择的容器
#speedControl input[type=range] 变速
#multiControl input[type=range] 变画频谱的倍率
#midivolumeControl input[type=range] midi音量
#play-btn button 播放
#actMode div 动作模式选择，其下有两个btn
#scrollbar-track div 滑动条轨道
#scrollbar-thumb div 滑动条
*/