function Spectrogram(target, spectrogram = null) {
    // 共享数据
    Object.setPrototypeOf(this, target);
    // 属性
    this.colorStep1 = 100;
    this.colorStep2 = 240;
    this.rectXstart = 0;
    this.rectYstart = 0;
    // 通通用箭头函数，固定this
    this.getColor = (value) => {  // 0-step1，是蓝色的亮度从0变为50%；step1-step2，是颜色由蓝色变为红色；step2-255，保持红色
        value = value || 0;
        let hue = 0, lightness = 50;    // Red hue
        if (value <= this.colorStep1) {
            hue = 240; // Blue hue
            lightness = (value / this.colorStep1) * 50; // Lightness from 0% to 50%
        } else if (value <= this.colorStep2) {
            hue = 240 - ((value - this.colorStep1) / (this.colorStep2 - this.colorStep1)) * 240;
            lightness = 50;
        } return `hsl(${hue}, 100%, ${lightness}%)`;
    };
    this.update = () => {
        let rectx = this.rectXstart;
        for (let x = this.idXstart; x < this.idXend; x++) {
            const s = this._spectrogram[x];
            let recty = this.rectYstart;
            for (let y = this.idYstart; y < this.idYend; y++) {
                this.ctx.fillStyle = this.getColor(s[y]);
                this.ctx.fillRect(rectx, recty, this.width, -this.height);
                recty -= this.height;
            }
            rectx += this.width;
        }
    }
    this.scroll2 = () => {
        this.idXend = Math.min(this.xnum, Math.ceil((this.scrollX + this.canvas.width) / this.width));
        this.idYend = Math.min(this.ynum, Math.ceil((this.scrollY + this.canvas.height) / this.height));
        this.rectXstart = this.idXstart * this.width - this.scrollX;
        this.rectYstart = this.canvas.height - this.idYstart * this.height + this.scrollY;
    }
    Object.defineProperty(this, 'spectrogram', {
        get: () => {
            return this._spectrogram;
        },
        set: (s) => {
            if (!s) {
                this._spectrogram = null;
                this.__proto__.xnum = 0;    // 通过原型链(而不是target)访问以保证灵活性（可以换原型，虽然很可能这个灵活性用不上）
                let loc = this.scrollEvent.indexOf(this.scroll2);
                if (loc != -1) this.scrollEvent.splice(loc, 1);
                loc = this.updateEvent.indexOf(this.draw);
                if (loc != -1) this.updateEvent.splice(loc, 1);
                return;
            } else {
                this._spectrogram = s;
                this.__proto__.xnum = s.length;
                if (!this.scrollEvent.includes(this.scroll2)) this.scrollEvent.push(this.scroll2);
                if (!this.updateEvent.includes(this.draw)) this.updateEvent.push(this.update);
            }
            this.__proto__.scroll2(0, this.height * this.ynum >> 1);  // 垂直方向上，视野移到中间
        }
    });
    this.spectrogram = spectrogram;
    target.plugins.push(this);
}