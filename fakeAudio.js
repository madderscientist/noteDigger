/**
 * 模拟没有声音、时长可变的Audio。模拟了：
 * 设置currentTime跳转播放位置
 * 设置playbackRate改变播放速度
 * play()和pause()控制播放
 * 到duration后自动停止，触发onended
 * duration改变后，触发ondurationchange
 * 构造后，下一个时刻触发ondurationchange和onloadeddata
 */
function FakeAudio(duration = Infinity) {
    this.readyState = 4;
    this.paused = true;
    this.volume = 0;    // 废物属性
    this.loop = false;  // 是否循环。和下面的_loop不一样
    this._currentTime = 0;
    this._duration = duration;
    this._playbackRate = 1;
    this._loop = 0;
    this._beginTime = 0;
    this._lastTime = 0;
    this.onended = Function.prototype;
    this.onloadeddata = Function.prototype;
    this.ondurationchange = Function.prototype;
    const update = (t) => {
        let dt = t - this._beginTime;
        this._currentTime = this._lastTime + dt * this._playbackRate / 1000;
        if (this._currentTime >= this._duration) {
            if (this.loop) {
                this.currentTime = 0;
            } else {
                this.pause();
                this.onended();
                return;
            }
        }
        this._loop = requestAnimationFrame(update);
    };
    this.pause = () => {
        cancelAnimationFrame(this._loop);
        this._lastTime = this._currentTime;
        this.paused = true;
    }
    this.play = () => {
        if (this._currentTime >= this._duration) this._lastTime = this._currentTime = 0;
        this._beginTime = document.timeline.currentTime;
        this._loop = requestAnimationFrame(update);
        this.paused = false;
    }
    Object.defineProperty(this, 'currentTime', {
        get: function () { return this._currentTime; },
        set: function (t) {
            if (t < 0) t = 0;
            if (t > this._duration) t = this._duration;
            this._lastTime = this._currentTime = t;
            this._beginTime = document.timeline.currentTime;
        }
    });
    Object.defineProperty(this, 'playbackRate', {
        get: function () { return this._playbackRate; },
        set: function (r) {
            this._playbackRate = r;
            this.currentTime = this._currentTime;
        }
    });
    Object.defineProperty(this, 'duration', {
        get: function () { return this._duration; },
        set: function (d) {
            if (d < 0) return;
            this._duration = d;
            this.ondurationchange();
        }
    });
    // 给设置handler留时间
    setTimeout(() => {
        this.ondurationchange();
        this.onloadeddata();
    }, 0);
}