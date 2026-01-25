/**
 * 管理频谱显示
 * 会使用 parent.layers.spectrum 画布
 * @param {App} parent 
 */
function _Spectrogram(parent) {
    this.colorStep1 = 90;
    this.colorStep2 = 240;
    this.multiple = parseFloat(document.getElementById('multiControl').value);  // 幅度的倍数
    this._spectrogram = null;
    this.mask = '#25262daa';
    this.getColor = (value) => {    // 0-step1，是蓝色的亮度从0变为50%；step1-step2，是颜色由蓝色变为红色；step2-255，保持红色
        value = value || 0;
        let hue = 0, lightness = 50;    // Red hue
        if (value <= this.colorStep1) {
            hue = 240;  // Blue hue
            lightness = (value / this.colorStep1) * 50; // Lightness from 0% to 50%
        } else if (value <= this.colorStep2) {
            hue = 240 - ((value - this.colorStep1) / (this.colorStep2 - this.colorStep1)) * 240;
        } return `hsl(${hue}, 100%, ${lightness}%)`;
    };
    // 不能用画图的坐标去限制，因为数据可能填不满画布 必须用id
    this.update = () => {   
        const canvas = parent.layers.spectrum;
        const ctx = canvas.ctx;
        let rectx = parent.rectXstart;
        for (let x = parent.idXstart; x < parent.idXend; x++) {
            const s = this._spectrogram[x];
            let recty = parent.rectYstart;
            for (let y = parent.idYstart; y < parent.idYend; y++) {
                ctx.fillStyle = this.getColor(s[y] * this.multiple);
                ctx.fillRect(rectx, recty, parent._width, -parent._height);
                recty -= parent._height;
            }
            rectx += parent._width;
        }
        let w = canvas.width - rectx;
        // 画分界线
        ctx.strokeStyle = "#FFFFFF";
        ctx.beginPath();
        for (let y = (((parent.idYstart / 12) | 0) + 1) * 12,
            rectY = canvas.height - parent.height * y + parent.scrollY,
            dy = -12 * parent.height;
            y < parent.idYend; y += 12, rectY += dy) {
            ctx.moveTo(0, rectY);
            ctx.lineTo(canvas.width, rectY);
        } ctx.stroke();
        // 填涂剩余部分
        if (w > 0) {
            ctx.fillStyle = '#25262d';
            ctx.fillRect(rectx, 0, w, canvas.height);
        }
        // 铺底色以凸显midi音符
        ctx.fillStyle = this.mask;
        ctx.fillRect(0, 0, rectx, canvas.height);
    };

    Object.defineProperty(this, 'spectrogram', {
        get: function() {
            return this._spectrogram;
        },
        set: function(s) {
            if (!s) {
                this._spectrogram = null;
                parent.xnum = 0;
            } else {
                this._spectrogram = s;
                parent.xnum = s.length;
                parent.scroll2();
            }
        }
    });

    Object.defineProperty(this, 'Alpha', {
        get: function() {
            return parseInt(this.mask.substring(7), 16);
        },
        set: function(a) {
            a = Math.min(255, Math.max(a | 0, 0));
            this.mask = '#25262d' + a.toString(16).padStart(2, '0');
            parent.layers.spectrum.dirty = true;
        }
    });
}