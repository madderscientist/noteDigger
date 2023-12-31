// 用这种方式(原始构造函数)的原因：解耦太难了，不解了。this全部指同一个
// 防止在html初始化之前getElement，所以封装成了构造函数，而不是直接写obj
function App() {
    this.spectrum = document.getElementById('spectrum');
    this.spectrum.ctx = this.spectrum.getContext('2d'); // 绘制相关参数的更改在this.resize中
    this.keyboard = document.getElementById('piano');
    this.keyboard.ctx = this.keyboard.getContext('2d', { alpha: false, desynchronized: true });
    this.timeBar = document.getElementById('timeBar');
    this.timeBar.ctx = this.timeBar.getContext('2d', { alpha: false, desynchronized: true });
    this._width = 16;    // 每格的宽度
    Object.defineProperty(this, 'width', {
        get: function () { return this._width; },
        set: function (w) {
            if (w < 0) return;
            this._width = w;
            this.TimeBar.updateInterval();
            this.HscrollBar.refreshSize();  // 刷新横向滑动条
        }
    });
    this._height = 16;   // 每格的高度
    Object.defineProperty(this, 'height', {
        get: function () { return this._height; },
        set: function (h) {
            if (h < 0) return;
            this._height = h;
            this.Keyboard._ychange.set([
                -1.5 * h, -2 * h, -1.5 * h, -1.5 * h, -2 * h, -2 * h, -1.5 * h,
                -2 * h, -3 * h, -2 * h, -2 * h, -2 * h
            ]);
            this.keyboard.ctx.font = `${h + 2}px Arial`;
        }
    });
    this.ynum = 84;     // 一共84个按键
    this.xnum = 0;      // 时间轴的最大长度 更新时要更新this.HscrollBar.refreshSize();
    this.scrollX = 0;   // 视野左边和世界左边的距离
    this.scrollY = 0;   // 视野下边和世界下边的距离
    this.idXstart = 0;  // 开始的X序号
    this.idYstart = 0;  // 开始的Y序号
    this.rectYstart = 0;// 画步开始的具体y坐标 迭代应该减height 被画频谱、画键盘共享
    this.loop = 0;      // 接收requestAnimationFrame的返回
    this.time = -1;     // 当前时间
    this.dt = 100;      // 每次分析的时间间隔 单位毫秒 在this.Analyser.analyse中更新
    this._mouseY = 0;   // 鼠标当前y坐标
    Object.defineProperty(this, 'mouseY', {
        get: function () { return this._mouseY; },
        set: function (y) {
            this._mouseY = y;
            this.Keyboard.highlight = Math.floor((this.scrollY + this.spectrum.height - y) / this._height) + 24;
        }
    });
    this.audioContext = null;
    this.Spectrogram = {
        parent: this,
        colorStep1: 100,
        colorStep2: 240,
        rectXstart: 0,
        idXend: 0,
        idYend: 0,
        multiple: 1,         // 幅度的倍数
        _spectrogram: null,
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
        update: () => {
            const sp = this.Spectrogram;
            if (!sp._spectrogram) return;
            const canvas = this.spectrum;
            const ctx = this.spectrum.ctx;
            let rectx = sp.rectXstart;
            for (let x = this.idXstart; x < sp.idXend; x++) {
                const s = sp._spectrogram[x];
                let recty = this.rectYstart;
                for (let y = this.idYstart; y < sp.idYend; y++) {
                    ctx.fillStyle = sp.getColor(s[y] * sp.multiple);
                    ctx.fillRect(rectx, recty, this._width, -this._height);
                    recty -= this._height;
                }
                rectx += this._width;
            }
            let w = canvas.width - rectx;
            // 画分界线
            ctx.beginPath();
            for (let y = (((this.idYstart / 12) | 0) + 1) * 12,
                rectY = canvas.height - this.height * y + this.scrollY,
                dy = -12 * this.height;
                y < sp.idYend; y += 12, rectY += dy) {
                ctx.moveTo(0, rectY);
                ctx.lineTo(canvas.width, rectY);
            } ctx.stroke();
            // 填涂剩余部分
            if (w > 0) {
                ctx.fillStyle = "#808080";
                ctx.fillRect(rectx, 0, w, canvas.height);
            }
            // 更新spectrum
            ctx.fillStyle = "#ffffff4f";
            rectx = canvas.height - (this.Keyboard.highlight - 24) * this._height + this.scrollY;
            ctx.fillRect(0, rectx, canvas.width, -this._height);
        },
        /**
         * 移动到 scroll to (x, y)
         * 由目标位置得到合法的scrollX和scrollY，并更新XY方向的scroll离散值起点(序号)
         * @param {Number} x 新视野左边和世界左边的距离
         * @param {Number} y 新视野下边和世界下边的距离
         */
        scroll2: () => {    // 单独更新一些量，不污染全局命名空间
            if (!this.Spectrogram._spectrogram) return;
            // 不能用画图的坐标去限制，因为数据可能填不满画布 必须用id
            this.Spectrogram.idXend = Math.min(this.xnum, Math.ceil((this.scrollX + this.spectrum.width) / this._width));
            this.Spectrogram.idYend = Math.min(this.ynum, Math.ceil((this.scrollY + this.spectrum.height) / this._height));
            this.Spectrogram.rectXstart = this.idXstart * this._width - this.scrollX;
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
                this.parent.xnum = s.length;
                this.parent.HscrollBar.refreshSize();
                this.parent.scroll2(0, (this.parent._height * this.parent.ynum - this.parent.spectrum.height) >> 1);  // 垂直方向上，视野移到中间
            }
        }
    };
    this.MidiAction = {
        clickXid: 0,
        clickYid: 0,
        _tempdx: 0, // 鼠标移动记录上次
        _tempdy: 0,
        _anyAction: false,  // 用于在选中多个后判断松开鼠标时应该如何处理选中
        /* 一个音符 = {
            y: 离散 和spectrum的y一致
            x1: 离散 起点
            x2: 离散 终点
        } */
        selected: [],   // 选中的音符 无序即可
        midi: [],       // 所有音符 需要维护有序性
        update: () => {
            const m = this.MidiAction.midi;
            if (m.length == 0) return;   // 二分查找要求长度大于0
            const s = this.spectrum.ctx;
            let drawStart = m.length;
            {   // 找到m中第一个x2值大于this.idXstart的音符的起始位置 由于m中元素较多 用二分查找
                let l = 0, r = drawStart - 1;
                while (l <= r) {
                    let mid = (l + r) >> 1;
                    if (m[mid].x2 > this.idXstart) {
                        r = mid - 1;
                        drawStart = mid;
                    } else l = mid + 1;
                }
            }
            for (; drawStart < m.length; drawStart++) {
                const note = m[drawStart];
                if (note.x1 >= this.Spectrogram.idXend) break;
                if (note.y < this.idYstart || note.y >= this.Spectrogram.idYend) continue;
                const params = [note.x1 * this._width - this.scrollX, this.spectrum.height - note.y * this._height + this.scrollY, (note.x2 - note.x1) * this._width, -this._height];
                if (note.selected) {
                    s.fillStyle = '#ffffff';
                    s.fillRect(...params);
                } else {    // 画白框红内矩形
                    s.fillStyle = '#FF0000';
                    s.fillRect(...params);
                    s.strokeRect(...params);
                }
            }
        },
        deleteNote: () => {
            this.MidiAction.selected.forEach((v) => {
                let i = this.MidiAction.midi.indexOf(v);
                if (i != -1) this.MidiAction.midi.splice(i, 1);
            });
            this.MidiAction.selected.length = 0;
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
            let dx = (((e.offsetX + this.scrollX) / this._width) | 0) - this.MidiAction.clickXid;  // 应该用|0因为向0取整
            this.MidiAction.selected.forEach((v) => {
                if ((v.x2 += dx - this.MidiAction._tempdx) <= v.x1) v.x2 = v.x1 + 1;
            });
            this.MidiAction._tempdx = dx;
        },
        changeNoteY: () => {    // 要求在trackMouse之后添加入spectrum的mousemoveEnent
            this.MidiAction._anyAction = true;
            let dy = this.Keyboard.highlight - 24 - this.MidiAction.clickYid;  // 应该用|0因为向0取整
            this.MidiAction.selected.forEach((v) => {
                v.y += dy - this.MidiAction._tempdy;
            });
            this.MidiAction._tempdy = dy;
        },
        changeNoteX: (e) => {
            this.MidiAction._anyAction = true;
            let dx = (((e.offsetX + this.scrollX) / this._width) | 0) - this.MidiAction.clickXid;  // 应该用|0因为向0取整
            this.MidiAction.selected.forEach((v) => {
                let d = v.x2 - v.x1;
                if ((v.x1 += dx - this.MidiAction._tempdx) < 0) v.x1 = 0; // 越界则设置为0
                v.x2 = v.x1 + d;
            });
            this.MidiAction._tempdx = dx;
        },
        /**
         * 添加音符的鼠标动作 由this.MidiAction.onclick调用
         */
        addNoteAction: () => {
            const m = this.MidiAction;
            // 取消已选
            m.clearSelected();
            // 添加新音符，设置已选
            const note = {
                y: m.clickYid,
                x1: m.clickXid,
                x2: m.clickXid + 1,
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
            this.spectrum.addEventListener('mousemove', m.changeNoteDuration);
            this.spectrum.addEventListener('mousemove', m.changeNoteY);
            // 也许需要在滑动的时候也计算changeNoteDuration
            const removeEvent = () => {
                this.spectrum.removeEventListener('mousemove', m.changeNoteDuration);
                this.spectrum.removeEventListener('mousemove', m.changeNoteY);
                document.removeEventListener('mouseup', removeEvent);
            }
            document.addEventListener('mouseup', removeEvent);
        },
        onclick_L: (e) => {
            //== step 1: 判断是否点在了音符上 ==//
            const m = this.MidiAction;
            const midi = m.midi;
            // 为了支持在鼠标操作的时候能滑动，记录绝对位置
            m._tempdx = m._tempdy = 0;
            const x = m.clickXid = ((e.offsetX + this.scrollX) / this._width) | 0;
            const y = m.clickYid = ((this.scrollY + this.spectrum.height - e.offsetY) / this._height) | 0;
            // 找到点击的最近的音符
            let n = null;
            for (let i = 0, distance = this._width * this.xnum; i < midi.length; i++) {
                let note = midi[i];
                let dis = x - note.x1;
                if (dis < 0) break;
                if (y == note.y && x <= note.x2) {
                    if (dis < distance) {
                        distance = dis;
                        n = note;
                    }
                }
            }
            if (!n) { m.addNoteAction(); return; }
            //== step 2: 如果点击到了音符，ctrl是否按下 ==/
            if (e.ctrlKey) {    // 有ctrl表示多选
                if (n.selected) {   // 已经选中了，取消选中
                    m.selected.splice(m.selected.indexOf(n), 1);
                    n.selected = false;
                } else {    // 没选中，添加选中
                    m.selected.push(n);
                    n.selected = true;
                } return;
            }
            //== step 3: 单选时，是否选中了多个(事关什么时候取消选中) ==//
            if (m.selected.length > 1 && n.selected) {    // 如果选择了多个，在松开鼠标的时候处理选中
                m._anyAction = false;
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
                    m._anyAction = false;
                    const up = () => {
                        if (!m._anyAction) {    // 没有任何拖拽动作，说明为了取消选中
                            m.selected.forEach(v => { v.selected = false; });
                            m.selected.length = 0;
                        }
                        document.removeEventListener('mouseup', up);
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
                }
                document.addEventListener('mouseup', removeEvent);
            } else {    // 靠近左侧，调整位置
                this.spectrum.addEventListener('mousemove', m.changeNoteX);
                this.spectrum.addEventListener('mousemove', m.changeNoteY);
                const removeEvent = () => {
                    this.spectrum.removeEventListener('mousemove', m.changeNoteX);
                    this.spectrum.removeEventListener('mousemove', m.changeNoteY);
                    document.removeEventListener('mouseup', removeEvent);
                    this.MidiAction.midi.sort((a, b) => a.x1 - b.x1);
                }
                document.addEventListener('mouseup', removeEvent);
            }
        },
    };
    this.AudioPlayer = {
        name: "请上传文件", // 在this.Analyser.onfile中赋值
        audio: document.createElement('audio'),
        play_btn: document.getElementById('play-btn'),
        update: () => {
            // this.timeBar.ctx.clearRect(0, 0, this.timeBar.width, this.timeBar.height);
        }
    };
    this.Keyboard = {
        highlight: -1,   // 选中了哪个音 音的编号以midi协议为准 C1序号为24 根this.mouseY一起在onmousemove更新
        freqTable: NoteAnalyser.freqTable(440),    // 在this.Analyser.analyse中赋值
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
        }
    }; this.height = this._height; // 更新this.Keyboard._ychange
    this.TimeBar = {
        interval: 10,   // 每个标注的间隔块数 在updateInterval中更新
        /**
         * 毫秒转 分:秒:毫秒
         * @param {Number} ms 毫秒数
         * @returns [分,秒,毫秒]
         */
        msToClock: (ms) => {
            return [
                Math.floor(ms / 60000),
                Math.floor((ms % 60000) / 1000),
                ms % 1000
            ];
        },
        update: () => {
            const canvas = this.timeBar;
            const ctx = this.timeBar.ctx;
            const tb = this.TimeBar;
            let idstart = Math.ceil(this.idXstart / tb.interval - 0.1);   // 画面中第一个时间点的序号
            let dt = tb.interval * this.dt;         // 时间的步长
            let dp = this.width * tb.interval;      // 像素的步长
            let timeAt = dt * idstart;              // 对应的毫秒
            let p = idstart * dp - this.scrollX;    // 对应的像素
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'black';
            ctx.beginPath();
            for (endPix = canvas.width + (dp >> 1); p < endPix; p += dp, timeAt += dt) {
                ctx.moveTo(p, 0);
                ctx.lineTo(p, canvas.height);
                const t = tb.msToClock(timeAt);
                let str = `${t[0].toString().padStart(2, "0")}:${t[1].toString().padStart(2, "0")}:${t[2].toString().padStart(3, "0")}`;
                ctx.fillText(str, p - 28, 18);
            } ctx.stroke();
        },
        updateInterval: () => {    // 根据this.width改变 在width的setter中调用
            const fontWidth = this.timeBar.ctx.measureText('00:00:000').width * 1.1;
            // 如果间距小于fontWidth则细分
            this.TimeBar.interval = Math.max(1, Math.ceil(fontWidth / this._width));
        }
        // todo: 重复区间设置
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
                let maxScrollX = this._width * this.xnum - this.spectrum.width;
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
            let maxScrollX = this._width * this.xnum - this.spectrum.width;
            let maxThumbLeft = track.offsetWidth - thumb.offsetWidth;
            let p = (e.offsetX - (thumb.offsetWidth >> 1)) / maxThumbLeft;  // nnd 减法优先级比位运算高
            this.scroll2(p * maxScrollX, this.scrollY);
        },
        refreshPosition: () => {
            let all = this._width * this.xnum - this.spectrum.width;
            let pos = (this.HscrollBar.track.offsetWidth - this.HscrollBar.thumb.offsetWidth) * this.scrollX / all;
            this.HscrollBar.thumb.style.left = pos + 'px';
        },
        refreshSize: () => {    // 需要在this.xnum this.width改变之后调用
            if (this.xnum) {
                this.HscrollBar.track.style.display = 'block';
                let p = Math.min(1, this.spectrum.width / (this._width * this.xnum));
                let nw = p * this.HscrollBar.track.offsetWidth;
                this.HscrollBar.thumb.style.width = Math.max(nw, 10) + 'px';    // 限制最小宽度
            } else {
                this.HscrollBar.track.style.display = 'hidden';
            }
        }
    };
    /**
     * 改变工作区(频谱、键盘、时间轴)大小
     * @param {Number} w 工作区的新宽度 默认撑满页面
     * @param {Number} h 工作区的新高度 默认充满父容器 父容器需设置flex:1;overflow:hidden;
     */
    this.resize = (w = window.innerWidth, h = document.getElementById('Canvases-Container').getBoundingClientRect().height) => {
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
        // 改变画布长宽之后，设置的值会重置，需要重新设置
        this.spectrum.ctx.strokeStyle = "#FFFFFF"; this.spectrum.ctx.lineWidth = 1;
        this.keyboard.ctx.lineWidth = 1; this.keyboard.ctx.font = `${this._height + 2}px Arial`;
        this.timeBar.ctx.strokeStyle = '#ff0000'; this.timeBar.ctx.font = '14px Arial';
        // 更新滑动条大小
        this.HscrollBar.refreshSize();
        this.scroll2(this.scrollX, this.scrollY);
    };
    /**
     * 移动到 scroll to (x, y)
     * 由目标位置得到合法的scrollX和scrollY，并更新XY方向的scroll离散值起点(序号)
     * @param {Number} x 新视野左边和世界左边的距离
     * @param {Number} y 新视野下边和世界下边的距离
     */
    this.scroll2 = (x = 0, y = 0) => {
        this.scrollX = Math.max(0, Math.min(x, this._width * this.xnum - this.spectrum.width));
        this.scrollY = Math.max(0, Math.min(y, this._height * this.ynum - this.spectrum.height));
        this.idXstart = (this.scrollX / this._width) | 0;
        this.idYstart = (this.scrollY / this._height) | 0;
        // 画图的y从左上角开始
        this.rectYstart = this.spectrum.height - this.idYstart * this._height + this.scrollY;
        this.Spectrogram.scroll2();
        // 滑动条
        this.HscrollBar.refreshPosition();
    };
    /**
     * 按倍数横向缩放时频图 以鼠标指针为中心
     * @param {Number} mouseX 
     * @param {Number} times 倍数 比用加减像素好，更连续
     */
    this.scaleX = (mouseX, times) => {
        let nw = this._width * times;
        if (nw < 3) return;
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
        this.Spectrogram.update();
        this.Keyboard.update();
        this.MidiAction.update();
        this.TimeBar.update();  // 必须在Spectrogram后更新，因为涉及时间指示的绘制
    };
    this.trackMouse = (e) => {  // onmousemove
        this.mouseY = e.offsetY;
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
         * 对audioBuffer执行小波变换 耗时估计会长，实际使用时再看要不要加ui进度指示
         * @param {AudioBuffer} audioBuffer 音频缓冲区
         * @param {Number} tNum 一秒几次分析 决定步距
         * @param {Number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
         * @param {Number} fftPoints 实数fft点数
         * @returns {Array<Float32Array>} 时频谱数据
         */
        analyse: async (audioBuffer, tNum = 10, A4 = 440, channel = -1, fftPoints = 8192) => {
            this.dt = 1000 / tNum;
            let dN = Math.round(audioBuffer.sampleRate / tNum);
            // 创建分析工具
            var fft = new realFFT(fftPoints); // 8192点在44100采样率下，最低能分辨F#2，但是足矣
            var analyser = new NoteAnalyser(audioBuffer.sampleRate / fftPoints, A4);
            if (this.Keyboard.freqTable[45] != A4) this.Keyboard.freqTable = new Float32Array(analyser.freqTable);   // 更新频率表
            function a(t) { // 对t执行小波变化，并整理为时频谱
                let nFinal = t.length - fftPoints;
                const result = new Array(((nFinal / dN) | 0) + 1);
                for (let n = 0, k = 0; n <= nFinal; n += dN) {
                    result[k++] = analyser.analyse(...fft.fft(t, n));
                } return result;
            }
            switch (channel) {
                case 0: return a(audioBuffer.getChannelData(0));
                case 1: return a(audioBuffer.getChannelData(1));
                case 2: {   // L+R
                    let length = audioBuffer.length;
                    const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                    if (audioBuffer.numberOfChannels > 1) {
                        let channelData = audioBuffer.getChannelData(1);
                        for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] + channelData[i]) * 0.5;
                    } return a(timeDomain);
                }
                case 3: {   // L-R
                    let length = audioBuffer.length;
                    const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                    if (audioBuffer.numberOfChannels > 1) {
                        let channelData = audioBuffer.getChannelData(1);
                        for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] - channelData[i]) * 0.5;
                    } return a(timeDomain);
                }
                default: {  // fft(L) + fft(R)
                    const l = a(audioBuffer.getChannelData(0));
                    const r = a(audioBuffer.getChannelData(1));
                    for (let i = 0; i < l.length; i++) {
                        const li = l[i];
                        for (let j = 0; j < li.length; j++)
                            li[j] = (li[j] + r[i][j]) * 0.5;
                    } return l;
                }
            }
        },
        onfile: (file) => {
            document.body.insertAdjacentHTML('afterbegin', `<div id="request-cover"><div class="card hvCenter"><label class="title">${file.name}</label><div><span>每秒的次数:</span><input type="number" name="ui-ask" value="10" min="1" max="100"></div><div><span>标准频率A4=</span><input type="number" name="ui-ask" value="440" step="0.1" min="55"></div><div>分析声道:</div><div><input type="radio" name="ui-ask" value="4" checked>Stereo<input type="radio" name="ui-ask" value="2">L+R<input type="radio" name="ui-ask" value="3">L-R<input type="radio" name="ui-ask" value="0">L<input type="radio" name="ui-ask" value="1">R</div><div><button id="ui-confirm">解析</button><button id="ui-cancel">取消</button></div></div></div>`);
            this.AudioPlayer.name = file.name;
            if (!this.audioBuffer) this.audioContext = new AudioContext({ sampleRate: 44100 });
            function close() { document.getElementById('request-cover').remove(); }
            document.getElementById('ui-cancel').onclick = () => {
                close(); this.AudioPlayer.audio.src = '';
            };
            document.getElementById('ui-confirm').onclick = () => {
                // 获取分析参数
                const params = document.getElementsByName('ui-ask');
                let tNum = params[0].value;
                let A4 = params[1].value;
                let channel = 4;
                for (let i = 2; i < 7; i++) {
                    if (params[i].checked) {
                        channel = params[i].value;
                        break;
                    }
                }
                close();
                // 打开另一个ui analyse加入回调以显示进度
                // 读取文件
                const fileReader = new FileReader();
                fileReader.onload = (e) => {
                    // 解码音频文件为音频缓冲区
                    this.audioContext.decodeAudioData(e.target.result, (decodedData) => {
                        this.Spectrogram.spectrogram = this.Analyser.analyse(
                            decodedData, tNum, A4, channel, 8192    // 可以考虑加一个“精度”选项
                        );
                    });
                    // 设置音频源 缓存到浏览器
                    this.AudioPlayer.audio.src = URL.createObjectURL(new Blob([e.target.result]));
                }; fileReader.readAsArrayBuffer(file);
            };
        }
    };
    //========= 事件注册 =========//
    document.getElementById('speedControl').oninput = (e) => { // 变速
        this.AudioPlayer.audio.playbackRate = e.target.value;
    };
    document.getElementById('multiControl').oninput = (e) => { // 变画频谱的倍率
        this.Spectrogram.multiple = e.target.value;
    };
    document.addEventListener('keydown', (e) => { // 键盘事件
        switch (e.key) {
            case 'ArrowUp': this.scroll2(this.scrollX, this.scrollY - this._height); break;
            case 'ArrowDown': this.scroll2(this.scrollX, this.scrollY + this._height); break;
            case 'ArrowLeft': this.scroll2(this.scrollX - this._width, this.scrollY); break;
            case 'ArrowRight': this.scroll2(this.scrollX + this._width, this.scrollY); break;
            case 'Delete': this.MidiAction.deleteNote(); break;
        }
    });
    this.AudioPlayer.play_btn.onclick = () => {
        // todo: 播放
    };
    window.addEventListener('resize', () => {
        this.resize();
    }); this.resize();
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
        this.trackMouse(e);
    });
    this.spectrum.addEventListener('mousedown', (e) => {
        // 有bug！正确执行一次后卡死
        if (e.button == 1) {    // 中键按下 动作同触摸板滑动 视窗移动
            const moveWindow = (e) => {
                this.scroll2(this.scrollX - e.movementX, this.scrollY + e.movementY);
            }; this.spectrum.addEventListener('mousemove', moveWindow);
            const up = () => {
                this.spectrum.removeEventListener('mousemove', moveWindow);
                document.removeEventListener('mouseup', up);
            }; document.addEventListener('mouseup', up);
        }
        if (e.button == 0) this.MidiAction.onclick_L(e);    // midi音符相关
    });
    this.HscrollBar.thumb.addEventListener('mousedown', this.HscrollBar.thumbMousedown);
    this.HscrollBar.track.addEventListener('mousedown', this.HscrollBar.trackMousedown);
    this.keyboard.addEventListener('wheel', (e) => {
        this.scroll2(this.scrollX, this.scrollY - e.deltaY);    // 只能上下移动
    });
    this.timeBar.addEventListener('dblclick', (e) => {
        // todo: 双击在此开始播放
    });
    this.timeBar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // todo: 菜单
    });
    this.spectrum.addEventListener('mousemove', this.trackMouse);
    this.spectrum.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // todo: 播放音符或者菜单
    });
    this.keyboard.addEventListener('mousemove', this.trackMouse);
    this.keyboard.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // todo: 播放音符
    });
    this.loopUpdate(true);
}
/*
需要什么dom?
#Canvases-Container div 决定画布高度
#spectrum canvas 画频谱
#piano canvas 画琴键
#timeBar canvas 画时间轴
#speedControl input[type=range] 变速
#multiControl input[type=range] 变画频谱的倍率
#play-btn button 播放
#scrollbar-track div 滑动条轨道
#scrollbar-thumb div 滑动条
*/