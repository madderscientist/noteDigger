/**
 * 配合scroll的滑动条
 * @param {App} parent 
 */
function _HscrollBar(parent) {
    this.refreshPosition = () => {  // 在parent.scroll2中调用
        let all = parent._width * parent._xnum - parent.layers.width;
        let pos = (track.offsetWidth - thumb.offsetWidth) * parent.scrollX / all;
        thumb.style.left = pos + 'px';
    };
    this.refreshSize = () => {      // 需要在parent.xnum parent.width改变之后调用 在二者的setter中调用
        track.style.display = 'block';
        let p = Math.min(1, parent.layers.width / (parent._width * parent._xnum));    // 由于有min存在所以xnum即使为零也能工作
        let nw = p * track.offsetWidth;
        thumb.style.width = Math.max(nw, 10) + 'px';    // 限制最小宽度
    };

    const track = document.getElementById('scrollbar-track');
    const thumb = document.getElementById('scrollbar-thumb');
    const thumbMousedown = (event) => { // 滑块跟随鼠标
        event.stopPropagation();        // 防止触发track的mousedown
        const startX = event.clientX;
        const thumbLeft = thumb.offsetLeft;
        const moveThumb = (event) => {
            let currentX = event.clientX - startX + thumbLeft;
            let maxThumbLeft = track.offsetWidth - thumb.offsetWidth;
            let maxScrollX = parent._width * parent._xnum - parent.layers.width;
            parent.scroll2(currentX / maxThumbLeft * maxScrollX, parent.scrollY);
        }
        const stopMoveThumb = () => {
            document.removeEventListener("mousemove", moveThumb);
            document.removeEventListener("mouseup", stopMoveThumb);
        }
        document.addEventListener("mousemove", moveThumb);
        document.addEventListener("mouseup", stopMoveThumb);
    };
    const trackMousedown = (e) => { // 滑块跳转
        e.stopPropagation();
        let maxScrollX = parent._width * parent._xnum - parent.layers.width;
        let maxThumbLeft = track.offsetWidth - thumb.offsetWidth;
        let p = (e.offsetX - (thumb.offsetWidth >> 1)) / maxThumbLeft;  // nnd 减法优先级比位运算高
        parent.scroll2(p * maxScrollX, parent.scrollY);
    };
    thumb.addEventListener('mousedown', thumbMousedown);
    track.addEventListener('mousedown', trackMousedown);
}