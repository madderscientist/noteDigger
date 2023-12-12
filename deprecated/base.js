class Base {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 16;    // 每格的宽度
        this.height = 16;   // 每格的高度
        this.scrollX = 0;   // 视野左边和世界左边的距离
        this.scrollY = 0;   // 视野下边和世界下边的距离
        this.idXstart = 0;  // 开始的X序号
        this.idYstart = 0;  // 开始的Y序号
        this.ynum = 84;     // 一共84个按键
        this.xunm = 0;      // 时间轴的最大长度
        this.time = -1;
        this.scrollEvent = [];
        this.updateEvent = [];
        this.resizeEvent = [];
        this.plugins = [];
        this.registEvent();
        this.loop = 0;
    }
    resize(w, h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.scroll2(this.scrollX, this.scrollY);
        for (let e of this.resizeEvent) e();
    }
    scaleX(mouseX, times) {
        let nw = this.width * times;
        if (nw < 5) return;
        if (nw > this.canvas.width >> 2) return;
        this.width = nw;
        this.scroll2((this.scrollX + mouseX) * times - mouseX, this.scrollY);
    }
    /**
     * 移动到 scroll to (x, y)
     * 由目标位置得到合法的scrollX和scrollY，并更新XY方向的scroll离散值起点(序号)
     * @param {Number} x 新视野左边和世界左边的距离
     * @param {Number} y 新视野下边和世界下边的距离
     */
    scroll2(x, y) {
        this.scrollX = Math.max(0, Math.min(x, this.width * this.xnum - this.canvas.width));
        this.scrollY = Math.max(0, Math.min(y, this.height * this.ynum - this.canvas.height));
        this.idXstart = (this.scrollX / this.width) | 0;
        this.idYstart = (this.scrollY / this.height) | 0;
        for (let e of this.scrollEvent) e();
    }
    update() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (let e of this.updateEvent) e();
    }
    registEvent() {
        this.canvas.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {    // 缩放
                e.preventDefault();
                this.scaleX(e.offsetX, e.deltaY > 0 ? 1.25 : 0.8);
            } else if(e.shiftKey) { // 垂直滚动
                // 只有鼠标滚轮时是有deltaY。所以这里让X方向能移动，做法是交换X和Y
                this.scroll2(this.scrollX + e.deltaY, this.scrollY + e.deltaX);
            } else {
                this.scroll2(this.scrollX + e.deltaX, this.scrollY + e.deltaY);
            }   // 只改状态，但不绘图。绘图交给固定时间刷新完成
        });
    }
    /**
     * 动画循环绘制
     * @param {Boolean} loop 是否开启循环
     */
    loopUpdate(loop = true) {
        if(loop) {
            const update = (t) => {
                this.update();
                this.loop = requestAnimationFrame(update);
            };  // 必须用箭头函数包裹，以固定this的指向
            this.loop = requestAnimationFrame(update);
        } else {
            cancelAnimationFrame(this.loop);
        }

    }
}
/* 插件要求
定义scroll2函数并push到scrollEvent"注册";
定义update函数并push到updateEvent"注册";
将自身加入plugins
*/