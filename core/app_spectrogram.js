/**
 * 管理频谱显示
 * 会使用 parent.layers.spectrum 画布
 * @param {App} parent 
 */
function _Spectrogram(parent) {
    this.colorStep1 = 90;
    this.colorStep2 = 240;

    this._multiple = parseFloat(document.getElementById('multiControl').value);  // 幅度的倍数
    Object.defineProperty(this, 'multiple', {
        get: function() { return this._multiple; },
        set: function(m) {
            this._multiple = m;
            parent.layers.spectrum.dirty = true;
        }
    });

    this._Hmultiple = 1;  // 谐波的倍数
    Object.defineProperty(this, 'Hmultiple', {
        get: function() { return this._Hmultiple; },
        set: function(m) {
            this._Hmultiple = m;
            parent.layers.spectrum.dirty = true;
        }
    });

    this._spectrogram = null;   // .raw属性为底层一维buffer
    Object.defineProperty(this, 'spectrogram', {
        get: function() { return this._spectrogram; },
        set: function(s) {
            if (!s) {
                this._spectrogram = this.harmonic = null;
                parent.xnum = 0;
            } else {
                if (s.raw != this._spectrogram?.raw) {
                    this._spectrogram = s;
                    this.harmonic = null;
                }
                parent.xnum = s.length;
                parent.scroll2();
            }
        }
    });

    this.harmonic = null;  // 对谐波的估计 在parent.Analyser._reduceHarmonic中计算得到

    this.getColor = (value) => {    // 0-step1，是蓝色的亮度从0变为50%；step1-step2，是颜色由蓝色变为红色；step2-255，保持红色
        value = value || 0; // 防NaN
        if (value < 0) value = 0;
        let hue = 0, lightness = 50;    // Red hue
        if (value <= this.colorStep1) {
            hue = 240;  // Blue hue
            lightness = (value / this.colorStep1) * 50; // Lightness from 0% to 50%
        } else if (value <= this.colorStep2) {
            hue = 240 - ((value - this.colorStep1) / (this.colorStep2 - this.colorStep1)) * 240;
        } return `hsl(${hue}, 100%, ${lightness}%)`;
    };
    // 预计算颜色查找表
    this.colorLUT = ((LUT_SIZE = 384) => {
        const c = new OffscreenCanvas(LUT_SIZE, 1);
        const ctx = c.getContext('2d', { alpha: false });
        for (let i = 0; i < LUT_SIZE; i++) {
            const value = (i / (LUT_SIZE - 1)) * 255;
            ctx.fillStyle = this.getColor(value);
            ctx.fillRect(i, 0, 1, 1);
        }
        const data = ctx.getImageData(0, 0, LUT_SIZE, 1).data;
        // 检测平台字节序
        const littleEndian = (function() {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setUint32(0, 0x12345678, true);
            return new Uint8Array(buf)[0] === 0x78;
        })();
        let u32 = new Uint32Array(LUT_SIZE);
        u32.scale = (LUT_SIZE - 1) / 255;
        for (let i = 0; i < LUT_SIZE; i++) {
            const idx = i << 2;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = 255;
            // 小端: ARGB 大端: RGBA
            u32[i] = littleEndian ? (a << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | a;
        } return u32;
    })();
    // 闭包存储
    var imageData = null;
    var dataCanvas = null;
    this.onresize = () => { // 在parent.width / parent.height / parent.resize 中被调用
        const canvas = parent.layers.spectrum;
        const ctx = canvas.ctx;
        // 实际视图的最大行列数
        let cols = Math.ceil(canvas.width / parent._width) + 1, rows = Math.ceil(canvas.height / parent._height) + 1;
        // 频谱列主序 这里存转置后的
        imageData = ctx.createImageData(rows, cols);
        ctx.imageSmoothingEnabled = parent._width < 1 || parent._height < 1;
        imageData.u32 = new Uint32Array(imageData.data.buffer);
        if (dataCanvas) {
            dataCanvas.width = rows;
            dataCanvas.height = cols;
        } else {
            dataCanvas = new OffscreenCanvas(rows, cols);
            dataCanvas.ctx = dataCanvas.getContext('2d', { alpha: false });
        }
        ctx.strokeStyle = "#FFFFFF";    // 分界线颜色
        ctx.fillStyle = '#25262d';      // 背景颜色
    };
    this.renderSpectrum = (ctx) => {
        // 填充数据到imagerData 随spectrum的列主序
        for (let frameID = parent.idXstart, x = 0, off = 0; frameID < parent.idXend; frameID++, x++, off += imageData.width) {
            const s = this._spectrogram[frameID];
            const h = this.harmonic?.[frameID];
            for (let y = parent.idYstart, j = off; y < parent.idYend; y++, j++) {
                let amp = (s[y] - (h?.[y] ?? 0) * this._Hmultiple) * this._multiple;
                const colorID = Math.min(this.colorLUT.length - 1, Math.max(0, Math.round(amp * this.colorLUT.scale)));
                imageData.u32[j] = this.colorLUT[colorID];
            }
        } dataCanvas.ctx.putImageData(imageData, 0, 0);
        // 把dataCanvas画到目标canvas上 drawImage 承担三个任务：旋转、缩放、偏移
        ctx.save();
        ctx.translate(0, 0); ctx.rotate(-Math.PI * 0.5);
        ctx.drawImage(
            dataCanvas, 
            0, 0, imageData.width, imageData.height,
            -parent.rectYstart, parent.rectXstart,
            imageData.width * parent._height, imageData.height * parent._width
        ); ctx.restore();
    }
    this.render = ({ctx, width, height}) => {
        if (this._spectrogram) this.renderSpectrum(ctx);
        // 填涂剩余部分
        let end = parent.idXend * parent._width - parent.scrollX;
        let w = width - end;
        if (w > 0) ctx.fillRect(end, 0, w, height);
        // 绘制分界线
        ctx.beginPath();
        for (let y = (((parent.idYstart / 12) | 0) + 1) * 12,
            rectY = height - parent._height * y + parent.scrollY,
            dy = -12 * parent._height;
            y < parent.idYend; y += 12, rectY += dy) {
            ctx.moveTo(0, rectY);
            ctx.lineTo(width, rectY);
        } ctx.stroke();
    };
}