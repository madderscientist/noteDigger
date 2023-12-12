// 用这种方式(原始构造函数)的原因：解耦太难了，不解了。this全部指同一个
// 防止在html初始化之前getElement，所以封装成了构造函数，而不是直接写obj
function App() {
    this.spectrum = document.getElementById('spectrum');
    this.spectrum.ctx = this.spectrum.getContext('2d');
    this.keyboard = document.getElementById('piano');
    this.keyboard.ctx = this.keyboard.getContext('2d');
    this.keyboard.ctx.strokeStyle = "black"; this.keyboard.ctx.lineWidth = 1; this.keyboard.ctx.font = "14px Arial";
    this.timeBar = document.getElementById('timeBar');
    this.timeBar.ctx = this.timeBar.getContext('2d');
    this.width = 16;    // 每格的宽度
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
        }
    });
    this.ynum = 84;     // 一共84个按键
    this.xnum = 0;      // 时间轴的最大长度
    this.scrollX = 0;   // 视野左边和世界左边的距离
    this.scrollY = 0;   // 视野下边和世界下边的距离
    this.idXstart = 0;  // 开始的X序号
    this.idYstart = 0;  // 开始的Y序号
    this.rectYstart = 0;// 画步开始的具体y坐标 迭代应该减height 被画频谱、画键盘共享
    this.loop = 0;      // 接收requestAnimationFrame的返回
    this.time = -1;     // 当前时间
    this.dt = 0.1;      // 每次分析的时间间隔 在this.Analyser.analyse中更新
    this._mouseY = 0;    // 鼠标当前y坐标
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
            const ctx =  this.spectrum.ctx;
            let rectx = sp.rectXstart;
            for (let x = this.idXstart; x < sp.idXend; x++) {
                const s = sp._spectrogram[x];
                let recty = this.rectYstart;
                for (let y = this.idYstart; y < sp.idYend; y++) {
                    ctx.fillStyle = sp.getColor(s[y] * sp.multiple);
                    ctx.fillRect(rectx, recty, this.width, -this._height);
                    recty -= this._height;
                }
                rectx += this.width;
            }
            let w = canvas.width - rectx;
            if (w > 0) { // 填涂剩余部分
                ctx.fillStyle = "#808080";
                ctx.fillRect(rectx, 0, w, canvas.height);
            }
            // 更新spectrum
            ctx.fillStyle = "#ffffff4f";
            rectx = canvas.height - (this.Keyboard.highlight-24)*this._height + this.scrollY;
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
            this.Spectrogram.idXend = Math.min(this.xnum, Math.ceil((this.scrollX + this.spectrum.width) / this.width));
            this.Spectrogram.idYend = Math.min(this.ynum, Math.ceil((this.scrollY + this.spectrum.height) / this._height));
            this.Spectrogram.rectXstart = this.idXstart * this.width - this.scrollX;
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
                this.parent.scroll2(0, (this.parent._height * this.parent.ynum - this.parent.spectrum.height) >> 1);  // 垂直方向上，视野移到中间
            }
        }
    };
    this.MidiAction = {
        clickX: 0,
        clickY: 0,
        update: () => {

        },
        deleteNote: () => {

        },
        addNote: () => {

        },
        changeNoteTime: () => {

        }
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
            const w2 = w*0.618;
            ctx.clearRect(0, 0, w, this.keyboard.height);

            let noteID = this.idYstart + 24;    // 最下面对应的音的编号
            let note = noteID % 12;             // 一个八度中的第几个音
            let baseY = this.rectYstart + note * this._height;   // 这个八度左下角的y坐标
            noteID -= note;                     // 这个八度C的编号

            while (true) {
                ctx.beginPath();    // 必须写循环内
                for (let i = 0, rectY = baseY, id = noteID; i < 7 & rectY > 0; i++) { // 画白键
                    let dy = kbd._ychange[i];
                    if (this.Keyboard.highlight == id) {  // 被选中的
                        ctx.fillStyle = 'orange';
                        ctx.fillRect(0, rectY, w, dy);
                    } else {    // 画线即可 下划线
                        ctx.moveTo(0, rectY);
                        ctx.lineTo(w, rectY);
                    }
                    rectY += dy;
                    id += kbd._idchange[i];
                } ctx.stroke();
                // 写音阶名
                ctx.fillStyle = "black"; ctx.fillText(Math.floor(noteID / 12) - 1, w-14, baseY-4);
                baseY -= this._height; noteID++;
                for (let i = 7; i < 12; i++) {
                    ctx.fillStyle = this.Keyboard.highlight == noteID ? '#Ffa500ff' : 'black';
                    ctx.fillRect(0, baseY, w2, -this._height);
                    baseY += kbd._ychange[i];
                    noteID += kbd._idchange[i];
                    if (baseY < 0) return;
                }
            }
        }
    }; this.height = this._height; // 更新this.Keyboard._ychange

    this.resize = (w = window.innerWidth, h = window.innerHeight * 0.7) => {
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
        this.scroll2(this.scrollX, this.scrollY);
    };
    /**
     * 移动到 scroll to (x, y)
     * 由目标位置得到合法的scrollX和scrollY，并更新XY方向的scroll离散值起点(序号)
     * @param {Number} x 新视野左边和世界左边的距离
     * @param {Number} y 新视野下边和世界下边的距离
     */
    this.scroll2 = (x = 0, y = 0) => {
        this.scrollX = Math.max(0, Math.min(x, this.width * this.xnum - this.spectrum.width));
        this.scrollY = Math.max(0, Math.min(y, this._height * this.ynum - this.spectrum.height));
        this.idXstart = (this.scrollX / this.width) | 0;
        this.idYstart = (this.scrollY / this._height) | 0;
        // 画图的y从左上角开始
        this.rectYstart = this.spectrum.height - this.idYstart * this._height + this.scrollY;
        this.Spectrogram.scroll2();
    };
    this.scaleX = (mouseX, times) => {
        let nw = this.width * times;
        if (nw < 3) return;
        if (nw > this.spectrum.width >> 2) return;
        this.width = nw;
        this.scroll2((this.scrollX + mouseX) * times - mouseX, this.scrollY);
    };
    this.update = () => {
        // 首先要同步时间 如果音频播放了，就同步音频时间
        this.Spectrogram.update();
        this.Keyboard.update();
        this.MidiAction.update();
        this.AudioPlayer.update();
        // 以下测试用
        this.timeBar.ctx.fillStyle = 'rgb(255,2,235)'; this.timeBar.ctx.fillRect(0, 0, this.timeBar.width, this.timeBar.height);
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
         * 对audioBuffer执行小波变换
         * @param {AudioBuffer} audioBuffer 音频缓冲区
         * @param {Number} tNum 一秒几次分析 决定步距
         * @param {Number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
         * @param {Number} fftPoints 实数fft点数
         * @returns {Array<Float32Array>} 时频谱数据
         */
        analyse: (audioBuffer, tNum = 10, A4 = 440, channel = -1, fftPoints = 8192) => {
            this.dt = 1 / tNum;
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
            case 'ArrowLeft': this.scroll2(this.scrollX - this.width, this.scrollY); break;
            case 'ArrowRight': this.scroll2(this.scrollX + this.width, this.scrollY); break;
        }
    });
    this.AudioPlayer.play_btn.onclick = () => { // 播放
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
        } else {
            this.scroll2(this.scrollX + e.deltaX, this.scrollY - e.deltaY);
        }   // 只改状态，但不绘图。绘图交给固定时间刷新完成
        this.trackMouse(e);
    });
    this.keyboard.addEventListener('wheel', (e) => {
        this.scroll2(this.scrollX, this.scrollY - e.deltaY);    // 只能上下移动
    });
    this.timeBar.addEventListener('dblclick', (e) => {
        // 双击在此开始播放
    });
    this.spectrum.addEventListener('mousemove', this.trackMouse);
    this.keyboard.addEventListener('mousedown', this.trackMouse);
    this.loopUpdate(true);
}
/*
需要什么dom?
#spectrum canvas 画频谱
#piano canvas 画琴键
#timeBar canvas 画时间轴
#speedControl input[type=range] 变速
#multiControl input[type=range] 变画频谱的倍率
#play-btn button 播放
*/