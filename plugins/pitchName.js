window.plugins ??= [];
window.plugins.push(function (app) {
    // 显示音高
    var pitchName = null;
    const showPitchName = (ifshow) => {
        if (ifshow) {
            app.layerContainer.addEventListener('mousemove', app._trackMouseX);
            pitchName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        } else {
            app.layerContainer.removeEventListener('mousemove', app._trackMouseX);
            pitchName = null;
        }
    };
    const render = ({ctx}) => {
        let h = app.Keyboard.highlight;
        if (pitchName && h >= 0) {
            ctx.fillStyle = 'black';
            ctx.fillText(
                `${pitchName[h % 12]}${Math.floor(h / 12) - 1}`,
                app._mouseX - app._height * 1.5,
                app.layers.height - (h - 24) * app._height + app.scrollY - (app._height >> 3)
            );
        }
    };
    // 注册UI和绘制
    const tgtLabel = "设置";
    for (const t of window.menu.tabs) {
        if (t.dataset.name != tgtLabel) continue;
        const ul = t.item;
        const li = document.createElement('li');
        li.innerHTML = `<label>显示音名&nbsp;<input type="checkbox"></label>`;
        ul.appendChild(li);
        li.querySelector('input').onchange = function (e) {
            showPitchName(this.checked);
            e.stopPropagation();
            e.target.blur();
        }; break;
    }
    window.app.layers.action.register(render);
    console.log('plugin "pitchName" loaded');
});
if (window.app) {
    window.plugins.forEach(plugin => plugin(window.app));
    window.plugins = null;
}