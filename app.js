// 用这种方式(原始构造函数)的原因：解耦太难了，不解了。this全部指同一个。其次为了保证效率
// 防止在html初始化之前getElement，所以封装成了构造函数，而不是直接写obj
function App() {
    this.event = new EventTarget();
    // 键盘和时间轴
    this.keyboard = document.getElementById('piano');
    this.keyboard.ctx = this.keyboard.getContext('2d', { alpha: false, desynchronized: true });
    this.timeBar = document.getElementById('timeBar');
    this.timeBar.ctx = this.timeBar.getContext('2d', { alpha: false, desynchronized: true });
    // 工作区图层
    const getCanvasCtx = (id, alpha = true, desynchronized = false) => {
        const canvas = document.getElementById(id);
        canvas.ctx = canvas.getContext('2d', { alpha, desynchronized});
        canvas.dirty = true;
        return canvas;
    }
    this.layerContainer = document.getElementById('spectrum-layers');
    this.layers = this.layerContainer.layers = {
        spectrum: getCanvasCtx('spectrum', false),
        action: getCanvasCtx('actions', true),
    };
    Object.defineProperty(this.layers, 'width', {
        get: function () { return this.spectrum.width; },
        set: function (w) {
            for (const c in this) this[c].width = w;
        }, enumerable: false
    });
    Object.defineProperty(this.layers, 'height', {
        get: function () { return this.spectrum.height; },
        set: function (h) {
            for (const c in this) this[c].height = h;
        }, enumerable: false
    });

    this.midiMode = false;
    this.TperP = -1;
    this.PperT = -1;
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
            this.Keyboard.setYchange(h);
            this.keyboard.ctx.font = `${h + 2}px Arial`;
            this.layers.action.ctx.font = `${h}px Arial`;
        }
    });
    this.ynum = 84;     // 一共84个按键
    this._xnum = 0;     // 时间轴的最大长度
    Object.defineProperty(this, 'xnum', {   // midi模式下需要经常改变此值，故特设setter
        get: function () { return this._xnum; },
        set: function (n) {
            if (n <= 0) return;
            this._xnum = n;
            // 刷新横向滑动条
            this.HscrollBar.refreshPosition();
            this.HscrollBar.refreshSize();
            this.idXend = Math.min(this._xnum, Math.ceil((this.scrollX + this.layers.width) / this._width));
        }
    });
    this.dt = 50;       // 每次分析的时间间隔 单位毫秒 在this.Analyser.analyse中更新
    this.time = -1;     // 当前时间 单位：毫秒 在this.AudioPlayer.update中更新

    // 以下变量仅在scroll2中更新(特别标记的除外)
    this.scrollX = 0;   // 视野左边和世界左边的距离
    this.scrollY = 0;   // 视野下边和世界下边的距离
    this.idXstart = 0;  // 开始的X序号
    this.idYstart = 0;  // 开始的Y序号
    this.idXend = 0;    // 【还在 xnum setter 中更新】
    this.idYend = 0;
    this.rectXstart = 0;// 目前只有Spectrogram.update在使用
    this.rectYstart = 0;// 画布开始的具体y坐标(因为最下面一个不完整) 迭代应该减height 被画频谱、画键盘共享

    // spectrum的重绘仅在 视野滚动(scroll2) 数据改变(会触发scroll2) 倍率改变
    // 下面的函数控制action层的重绘 重绘时机: scroll2; AudioPlayer.update; 键鼠操作
    this.makeActDirty = () => { this.layers.action.dirty = true; }; // 供外部调用

    /**
     * 设置播放时间 如果立即播放(keep==false)则有优化
     * @param {number} t 时间点 单位：毫秒
     * @param {boolean} keep 是否保存之前的状态 如果为false则立即开始
     */
    this.setTime = (t, keep = true) => {
        this.synthesizer.stopAll();
        if (keep) {
            this.time = t;
            this.AudioPlayer.audio.currentTime = t / 1000;
            this.AudioPlayer.play_btn.firstChild.textContent = this.TimeBar.msToClockString(t);
            this.MidiPlayer.restart();
        } else {    // 用于双击时间轴立即播放
            this.AudioPlayer.start(t);  // 所有操作都在start中
        }
    };
    this._mouseY = 0;   // 鼠标当前y坐标
    Object.defineProperty(this, 'mouseY', {
        get: function () { return this._mouseY; },
        set: function (y) {
            this._mouseY = y;
            this.Keyboard.highlight = Math.floor((this.scrollY + this.layers.height - y) / this._height) + 24;
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
    this.preventShortCut = false;   // 当需要原始快捷键时(比如输入框)修改此为true
    this.audioContext = new AudioContext({ sampleRate: 44100 });
    this.synthesizer = new TinySynth(this.audioContext);
    this.Spectrogram = new _Spectrogram(this);
    this.MidiAction = new _MidiAction(this);
    this.MidiPlayer = new _MidiPlayer(this);
    this.AudioPlayer = new _AudioPlayer(this);
    this.Keyboard = new _Keyboard(this); this.height = this._height; // 更新this.Keyboard._ychange
    this.TimeBar = new _TimeBar(this);
    this.BeatBar = new _BeatBar(this);
    // 小插件对象
    this.pitchNameDisplay = {   // 音名显示 配合设置中的checkbox使用
        _showPitchName: null,
        showPitchName: (ifshow) => {
            if (ifshow) {
                this.layerContainer.addEventListener('mousemove', this._trackMouseX);
                this.pitchNameDisplay._showPitchName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            } else {
                this.layerContainer.removeEventListener('mousemove', this._trackMouseX);
                this.pitchNameDisplay._showPitchName = null;
            }
        },
        update: () => {
            if (this.pitchNameDisplay._showPitchName && this.Keyboard.highlight >= 0) {
                this.layers.action.ctx.fillStyle = 'black';
                this.layers.action.ctx.fillText(
                    `${this.pitchNameDisplay._showPitchName[this.Keyboard.highlight % 12]}${Math.floor(this.Keyboard.highlight / 12) - 1}`,
                    this._mouseX - this._height * 1.5,
                    this.layers.height - (this.Keyboard.highlight - 24) * this._height + this.scrollY - (this._height >> 3)
                );
            }
        }
    };
    // 撤销相关
    this.snapshot = new Snapshot(16, {
        // 用对象包裹，实现字符串的引用
        midi: { value: JSON.stringify(this.MidiAction.midi) },  // 音符移动、长度改变、channel改变后
        channel: { value: JSON.stringify(this.MidiAction.channelDiv.channel) }, // 音轨改变序号、增删、修改参数后
        beat: { value: JSON.stringify(this.BeatBar.beats) }
    });
    // changed = channel变化<<1 | midi变化<<2 | beat变化<<3
    this.snapshot.save = (changed = 0b111) => {
        const nowState = this.snapshot.nowState();
        const lastStateNotExists = nowState == null;
        this.snapshot.add({
            channel: (lastStateNotExists || (changed & 0b1)) ? { value: JSON.stringify(this.MidiAction.channelDiv.channel) } : nowState.channel,
            midi: (lastStateNotExists || (changed & 0b10)) ? { value: JSON.stringify(this.MidiAction.midi) } : nowState.midi,
            beat: (lastStateNotExists || (changed & 0b100)) ? { value: JSON.stringify(this.BeatBar.beats) } : nowState.beat
        });
    };
    this.HscrollBar = new _HscrollBar(this);
    this._copy = '';  // 用于复制音符 会是JSON字符串
    this.shortcutActions = {    // 快捷键动作
        'Ctrl+Z': () => {   // 撤销
            let lastState = this.snapshot.undo();
            if (!lastState) return;
            this.MidiAction.midi = JSON.parse(lastState.midi.value);
            this.MidiAction.selected = this.MidiAction.midi.filter((obj) => obj.selected);
            this.MidiAction.channelDiv.fromArray(JSON.parse(lastState.channel.value));
            this.BeatBar.beats.copy(JSON.parse(lastState.beat.value));
            this.MidiAction.updateView();
        },
        'Ctrl+Y': () => {
            let nextState = this.snapshot.redo();
            if (!nextState) return;
            this.MidiAction.midi = JSON.parse(nextState.midi.value);
            this.MidiAction.selected = this.MidiAction.midi.filter((obj) => obj.selected);
            this.MidiAction.channelDiv.fromArray(JSON.parse(nextState.channel.value));
            this.BeatBar.beats.copy(JSON.parse(nextState.beat.value));
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
            this.snapshot.save(0b10);   // 只保存midi的快照
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
     * @param {number} w 工作区的新宽度 默认充满父容器
     * @param {number} h 工作区的新高度 默认充满父容器
     * 充满父容器，父容器需设置flex:1;overflow:hidden;
     */
    this.resize = (w = undefined, h = undefined) => {
        const box = document.getElementById('Canvases-Container').getBoundingClientRect();
        w = w || box.width;
        h = h || box.height;
        let spectrumWidth, spectrumHeight;
        if (w > 80) {
            spectrumWidth = w - 80;
            this.keyboard.width = 80;
        } else {
            spectrumWidth = 0.4 * w;
            this.keyboard.width = 0.6 * w;
        }
        if (h > 40) {
            spectrumHeight = h - 40;
            this.timeBar.height = 40;
        } else {
            spectrumHeight = 0.4 * h;
            this.timeBar.height = 0.6 * h;
        }
        this.layers.height = this.keyboard.height = spectrumHeight;
        this.layers.width = this.timeBar.width = spectrumWidth;
        for (const c in this.layers) {
            const canvas = this.layers[c];
            canvas.width = spectrumWidth;
            canvas.height = spectrumHeight;
            canvas.ctx.lineWidth = 1;
            canvas.ctx.font = `${this._height}px Arial`;
        }
        document.getElementById('play-btn').style.width = this.keyboard.width + 'px';
        // 改变画布长宽之后，设置的值会重置，需要重新设置
        this.keyboard.ctx.lineWidth = 1; this.keyboard.ctx.font = `${this._height + 2}px Arial`;
        this.timeBar.ctx.font = '14px Arial';
        // 更新滑动条大小
        this.width = this._width;   // 除了触发滑动条更新，还能在初始化的时候保证timeBar的文字间隔
        this.scroll2();
    };
    /**
     * 移动到 scroll to (x, y)
     * 由目标位置得到合法的scrollX和scrollY，并更新XY方向的scroll离散值起点(序号)
     * @param {number} x 新视野左边和世界左边的距离
     * @param {number} y 新视野下边和世界下边的距离
     */
    this.scroll2 = (x = this.scrollX, y = this.scrollY) => {
        this.scrollX = Math.max(0, Math.min(x, this._width * this._xnum - this.layers.width));
        this.scrollY = Math.max(0, Math.min(y, this._height * this.ynum - this.layers.height));
        this.idXstart = (this.scrollX / this._width) | 0;
        this.idYstart = (this.scrollY / this._height) | 0;
        this.idXend = Math.min(this._xnum, Math.ceil((this.scrollX + this.layers.width) / this._width));
        this.idYend = Math.min(this.ynum, Math.ceil((this.scrollY + this.layers.height) / this._height));
        this.rectXstart = this.idXstart * this._width - this.scrollX;
        this.rectYstart = this.layers.height - this.idYstart * this._height + this.scrollY;   // 画图的y从左上角开始
        // 滑动条
        this.HscrollBar.refreshPosition();
        // 更新音符 action.dirty 置位
        this.MidiAction.updateView();
        this.layers.spectrum.dirty = true;
    };
    /**
     * 按倍数横向缩放时频图 以鼠标指针为中心
     * @param {number} mouseX
     * @param {number} times 倍数 比用加减像素好，更连续
     */
    this.scaleX = (mouseX, times) => {
        let nw = this._width * times;
        if (nw < 2) return;
        if (nw > this.layers.spectrum.width >> 2) return;
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
        if (this.layers.spectrum.dirty) {
            this.Spectrogram.update();  // 只更新spectrum画布
            this.layers.spectrum.dirty = false;
        }
        if (this.layers.action.dirty) {
            this.layers.action.ctx.clearRect(0, 0, this.layers.width, this.layers.height);
            this.Keyboard.update(); // 应最先 因为高亮显示不重要应该在最下面
            this.BeatBar.update();
            this.MidiAction.update();   // 应在BeatBar之后，节拍线应在音符下面
            this.TimeBar.update();  // 应最后绘制 因为时间指针应该在最上面
            this.pitchNameDisplay.update();
            this.layers.action.dirty = false;
        }
    };
    this.trackMouseY = (e) => { // onmousemove
        this.mouseY = e.offsetY;
    };
    this.trackMouseX = (e) => { // 用于框选，会更新frameX值 在this.MidiAction中add和remove事件监听器
        this.mouseX = e.offsetX;
    };
    this._trackMouseX = (e) => {// 给this.Spectrogram.showPitchName专用的，只会更新_mouseX
        this._mouseX = e.offsetX;
    };

    /**
     * 动画循环绘制
     * @param {boolean} loop 是否开启循环
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
    this.loop = 0;      // 接收requestAnimationFrame的返回

    //=========数据解析相关=========//
    this.Analyser = new _Analyser(this);
    //========= 导入导出 =========//
    this.io = new _IO(this);
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
        // 以下在没有频谱数据时不启用
        if (this.preventShortCut) return;
        if (!this.Spectrogram._spectrogram) return;
        let shortcut = '';
        // 检测平台并使用相应的修饰键
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const cmdKey = isMac ? e.metaKey : e.ctrlKey;
        const ctrlKey = isMac ? e.ctrlKey : false;

        if (cmdKey) shortcut += 'Ctrl+';  // 统一使用Ctrl+标识符，但实际检测平台对应的键
        if (ctrlKey && isMac) shortcut += 'RealCtrl+';  // Mac上的真正Ctrl键
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
                case 'PageUp': this.scroll2(this.scrollX - this.layers.spectrum.width, this.scrollY); break;
                case 'PageDown': this.scroll2(this.scrollX + this.layers.spectrum.width, this.scrollY); break;
                case 'Home': this.scroll2(0); this.setTime(0); break;
            }
        }
    });
    // audio可以后台播放，但是requestAnimationFrame不行，而时间同步在requestAnimationFrame中
    // 还有一个办法：在可见状态变化时，将update绑定到audio.ontimeupdate上，但是这个事件触发频率很低，而预测器根据60帧设计的
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.AudioPlayer.stop();
    });
    window.addEventListener('load', () => { this.resize(); });
    window.addEventListener('resize', () => { this.resize(); });
    this.layerContainer.addEventListener('wheel', (e) => {
        // e.deltaY 往前滚是负数
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const cmdKey = isMac ? e.metaKey : e.ctrlKey;

        if (cmdKey) {    // 缩放
            e.preventDefault();
            this.scaleX(e.offsetX, e.deltaY > 0 ? 0.8 : 1.25);
        } else if (e.shiftKey) { // 垂直滚动
            // 只有鼠标滚轮时是有deltaY。所以这里让X方向能移动，做法是交换X和Y
            this.scroll2(this.scrollX + e.deltaY, this.scrollY + e.deltaX);
        } else {    // 触摸板的滑动也是wheel
            this.scroll2(this.scrollX + e.deltaX, this.scrollY - e.deltaY);
        }   // 只改状态，但不绘图。绘图交给固定时间刷新完成
        this.trackMouseY(e);
    });
    this.layerContainer.contextMenu = new ContextMenu([
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
    this.layerContainer.addEventListener('mousedown', (e) => {
        if (e.button == 1) {    // 中键按下 动作同触摸板滑动 视窗移动
            const moveWindow = (e) => {
                this.scroll2(this.scrollX - e.movementX, this.scrollY + e.movementY);
            }; this.layerContainer.addEventListener('mousemove', moveWindow);
            const up = () => {
                this.layerContainer.removeEventListener('mousemove', moveWindow);
                document.removeEventListener('mouseup', up);
            }; document.addEventListener('mouseup', up);
            return;
        }
        // 以下在没有频谱数据时不启用
        if (this.Spectrogram._spectrogram) {
            if (e.button == 0) this.MidiAction.onclick_L(e);    // midi音符相关
            else if (e.button == 2 && e.shiftKey) {
                this.layerContainer.contextMenu.show(e);
                e.stopPropagation();
            } else this.MidiAction.clearSelected();    // 取消音符选中
        } this.Keyboard.mousedown();    // 将发声放到后面，因为onclick_L会改变选中的音轨
    });
    this.layerContainer.addEventListener('mousemove', this.trackMouseY);
    this.layerContainer.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    this.timeBar.addEventListener('dblclick', (e) => {
        if (this.AudioPlayer.audio.readyState != 4) return;
        this.setTime((e.offsetX + this.scrollX) * this.AudioPlayer.audio.duration * 1000 / (this._xnum * this._width), false);
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
                if (this.BeatBar.belongID > -1) {   // 在小节轴上
                    let _anyAction = false; // 是否存档
                    this.timeBar.removeEventListener('mousemove', this.BeatBar.moveCatch);
                    const m = this.BeatBar.beats.setMeasure(this.BeatBar.belongID, undefined, false);
                    const startAt = m.start * this.PperT;
                    let setMeasure;
                    if (e.shiftKey) {   // 只改变小节线位置
                        const nextM = this.BeatBar.beats.setMeasure(m.id + 1, undefined, false);
                        this.BeatBar.beats.setMeasure(m.id + 2, undefined, false);  // 下下个也要创建
                        setMeasure = (e2) => {
                            _anyAction = true;
                            m.interval = Math.max(100, (e2.offsetX + this.scrollX - startAt) * this.TperP);
                            nextM.interval -= m.start + m.interval - nextM.start;
                            this.BeatBar.beats.check(false);
                        };
                    } else {    // 改变小节线位置并移动后续小节
                        setMeasure = (e2) => {
                            _anyAction = true;
                            m.interval = Math.max(100, (e2.offsetX + this.scrollX - startAt) * this.TperP);
                            this.BeatBar.beats.check(false);    // 关闭小节合并 否则会丢失小节对象
                        };
                    }
                    let removeEvents = () => {
                        document.removeEventListener('mousemove', setMeasure);
                        this.timeBar.addEventListener('mousemove', this.BeatBar.moveCatch);
                        document.removeEventListener('mouseup', removeEvents);
                        this.BeatBar.beats.check(true);
                        if (_anyAction) this.snapshot.save(0b100);
                    };
                    document.addEventListener('mousemove', setMeasure);
                    document.addEventListener('mouseup', removeEvents);
                } else {
                    const x = (e.offsetX + this.scrollX) / this._width * this.dt;    // 毫秒数
                    const originStart = this.TimeBar.repeatStart;
                    const originEnd = this.TimeBar.repeatEnd;
                    const mouseDownX = e.offsetX;
                    let mouseUpX = mouseDownX;
                    const setRepeat = (e) => {
                        mouseUpX = e.offsetX;
                        const newX = (e.offsetX + this.scrollX) / this._width * this.dt;
                        if (newX > x) this.TimeBar.setRepeat(x, newX);
                        else this.TimeBar.setRepeat(newX, x);
                    };
                    let removeEvents = () => {
                        this.timeBar.removeEventListener('mousemove', setRepeat);
                        document.removeEventListener('mouseup', removeEvents);
                        // 有时候双击的小小移动会误触重复区间 所以如果区间太小则忽视
                        if (Math.abs(mouseUpX - mouseDownX) < 6) this.TimeBar.setRepeat(originStart, originEnd);
                    };
                    this.timeBar.addEventListener('mousemove', setRepeat);
                    document.addEventListener('mouseup', removeEvents);
                }
                break;
            case 1:     // 中键跳转位置但不改变播放状态
                this.setTime((e.offsetX + this.scrollX) / this._width * this.dt);
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

    // 用户鼠标操作触发刷新
    document.addEventListener('mousemove', this.makeActDirty);
    document.addEventListener('mousedown', this.makeActDirty);
    document.addEventListener('mouseup', this.makeActDirty);
    document.addEventListener('keydown', this.makeActDirty);
    // wheel->scroll2 已触发刷新

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