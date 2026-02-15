/// <reference path="beatBar.js" />
/// <reference path="contextMenu.js" />

/**
 * 顶部小节轴
 * @param {App} parent 
 */
function _BeatBar(parent) {
    this.beats = new Beats();
    this.minInterval = 20;  // 最小画线间隔
    this.update = () => {
        const canvas = parent.timeBar;
        const ctx = parent.timeBar.ctx;

        ctx.fillStyle = '#2e3039';
        const h = canvas.height >> 1;
        ctx.fillRect(0, h, canvas.width, canvas.width);
        ctx.fillStyle = '#8e95a6';
        const spectrum = parent.layers.action.ctx;
        const spectrumHeight = parent.layers.action.height;
        ctx.strokeStyle = '#f0f0f0';
        spectrum.strokeStyle = '#c0c0c0';

        const beatX = [];   // 小节内每一拍
        const noteX = [];   // 一拍内x分音符对齐线

        const iterator = this.beats.iterator(parent.scrollX * parent.TperP, true);
        ctx.beginPath(); spectrum.beginPath();
        while (1) {
            let measure = iterator.next();
            if (measure.done) break;
            measure = measure.value;
            let x = measure.start * parent.PperT - parent.scrollX;
            if (x > canvas.width) break;
            ctx.moveTo(x, h);
            ctx.lineTo(x, canvas.height);
            spectrum.moveTo(x, 0);
            spectrum.lineTo(x, spectrumHeight);
            // 写字 会根据间隔决定是否显示拍型
            const Interval = measure.interval * parent.PperT;
            ctx.fillText(Interval < 38 ? measure.id : `${measure.id}. ${measure.beatNum}/${measure.beatUnit}`, x + 2, h + 14);
            // 画更细的节拍线
            const dp = Interval / measure.beatNum;
            if (dp < this.minInterval) continue;
            x += dp;
            for (let i = measure.beatNum - 1; i > 0; i--, x += dp) beatX.push(x);
            // 画x分音符的线
            const noteNum = 1 << Math.log2(dp / this.minInterval);
            if (noteNum < 2) continue;
            const noteInterval = dp / noteNum;
            for (let i = 0, n = noteNum * measure.beatNum; i < n; i++, x -= noteInterval) {
                if (i % noteNum == 0) continue; // 跳过beat线
                noteX.push(x);
            }
        } ctx.stroke(); spectrum.stroke();

        if (beatX.length != 0) {
            spectrum.beginPath();
            spectrum.strokeStyle = '#909090';
            for (const x of beatX) {
                spectrum.moveTo(x, 0);
                spectrum.lineTo(x, spectrumHeight);
            } spectrum.stroke();
        }

        if (noteX.length != 0) {
            spectrum.beginPath();
            spectrum.setLineDash([4, 4]);
            spectrum.strokeStyle = '#606060';
            for (const x of noteX) {
                spectrum.moveTo(x, 0);
                spectrum.lineTo(x, spectrumHeight);
            } spectrum.stroke();
            spectrum.setLineDash([]);   // 恢复默认
        }
    };
    this.contextMenu = new ContextMenu([
        {
            name: "设置小节",
            callback: (e_father, e_self) => {
                const bs = this.beats;
                const m = bs.setMeasure((e_father.offsetX + parent.scrollX) * parent.TperP, undefined, true);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = `
<div class="request-cover">
    <div class="card hvCenter"><label class="title">小节${m.id}设置</label>
        <div class="layout"><span>拍数</span><input type="text" name="ui-ask" step="1" max="16" min="1"></div>
        <div class="layout"><span>音符</span><select name="ui-ask">
            <option value="2">2分</option>
            <option value="4">4分</option>
            <option value="8">8分</option>
            <option value="16">16分</option>
        </select></div>
        <div class="layout"><span>BPM:</span><input type="number" name="ui-ask" min="1"></div>
        <div class="layout"><span>(忽略BPM)保持小节长度</span><input type="checkbox" name="ui-ask"></div>
        <div class="layout"><span>(忽略以上)和上一小节一样</span><input type="checkbox" name="ui-ask"></div>
        <div class="layout"><span>应用到后面相邻同类型小节</span><input type="checkbox" name="ui-ask" checked></div>
        <div class="layout"><button class="ui-cancel">取消</button><button class="ui-confirm">确定</button></div>
    </div>
</div>`;
                const Pannel = tempDiv.firstElementChild;
                document.body.insertBefore(Pannel, document.body.firstChild);
                Pannel.tabIndex = 0;
                Pannel.focus();
                function close() { Pannel.remove(); }
                const inputs = Pannel.querySelectorAll('[name="ui-ask"]');
                const btns = Pannel.getElementsByTagName('button');
                inputs[0].value = m.beatNum;    // 拍数
                inputs[1].value = m.beatUnit;   // 音符类型
                inputs[2].value = m.bpm;        // bpm
                btns[0].onclick = close;
                btns[1].onclick = () => {
                    if (!inputs[5].checked) {   // 后面不变
                        bs.setMeasure(m.id + 1, undefined, false); // 让下一个生成实体
                    }
                    if (inputs[4].checked) {    // 和上一小节一样
                        let last = bs.getMeasure(m.id - 1, false);
                        m.copy(last);
                    } else {
                        m.beatNum = parseInt(inputs[0].value);
                        m.beatUnit = parseInt(inputs[1].value);
                        if (!inputs[3].checked) m.bpm = parseFloat(inputs[2].value);
                    } bs.check(); close();
                    parent.snapshot.save(0b100);
                };
            }
        }, {
            name: "后方插入一小节",
            callback: (e_father) => {
                this.beats.add((e_father.offsetX + parent.scrollX) * parent.TperP, true);
                parent.snapshot.save(0b100);
            }
        }, {
            name: "均分该小节",
            callback: (e_father) => {
                const beatarr = this.beats;
                const base = beatarr.setMeasure((e_father.offsetX + parent.scrollX) * parent.TperP, undefined, true, true);
                const baseM = beatarr[base];
                // 下一小节若未定义则定义 则插入一个 防止影响后面
                if (base + 1 >= beatarr.length || beatarr[base + 1].id > baseM.id + 1)
                    beatarr.splice(base + 1, 0, eMeasure.baseOn(baseM, baseM.id + 1));
                // 插入新的 用id位移实现
                baseM.interval /= 2;
                for (let i = base + 1; i < beatarr.length; i++) beatarr[i].id++;
                beatarr.check(true);
                parent.snapshot.save(0b100);
            }
        }, {
            name: "分裂为单拍",
            callback: (e_father) => {
                const beatarr = this.beats;
                const base = beatarr.setMeasure((e_father.offsetX + parent.scrollX) * parent.TperP, undefined, true, true);
                const baseM = beatarr[base];
                if (base + 1 >= beatarr.length || beatarr[base + 1].id > baseM.id + 1)
                    beatarr.splice(base + 1, 0, eMeasure.baseOn(baseM, baseM.id + 1));
                const beatNum = baseM.beatNum;
                baseM.interval /= beatNum;
                for (let i = base + 1; i < beatarr.length; i++) beatarr[i].id += beatNum - 1;
                beatarr.check(true);
                parent.snapshot.save(0b100);
            }
        }, {
            name: "合并下一小节",
            callback: (e_father) => {
                const beatarr = this.beats;
                const base = beatarr.setMeasure((e_father.offsetX + parent.scrollX) * parent.TperP, undefined, true, true);
                const baseM = beatarr[base];
                // 下下个
                const nextnext = beatarr.setMeasure(baseM.id + 2, undefined, false, true);
                const nextnextM = beatarr[nextnext];
                if (nextnext === base + 2) {
                    // 中间隔了一个小节头
                    const deleted = beatarr.splice(base + 1, 1)[0];
                    baseM.interval += deleted.interval;
                    baseM.beatNum += deleted.beatNum;
                } else {
                    baseM.interval += baseM.interval;
                    baseM.beatNum += baseM.beatNum;
                }
                for (let i = base + 1; i < beatarr.length; i++) beatarr[i].id--;
                beatarr.check(true);
                parent.snapshot.save(0b100);
            }
        }, {
            name: "重置后面所有小节",
            callback: (e_father) => {
                const base = this.beats.getBaseIndex((e_father.offsetX + parent.scrollX) * parent.TperP, true);
                this.beats.splice(base + 1);
                parent.snapshot.save(0b100);
            }
        }, {
            name: '<span style="color: red;">删除该小节</span>',
            callback: (e_father, e_self) => {
                this.beats.delete((e_father.offsetX + parent.scrollX) * parent.TperP, true);
                parent.snapshot.save(0b100);
            }
        }
    ]);
    this.belongID = -1;  // 小节线前一个小节的id
    this.moveCatch = (e) => {   // 画布上光标移动到小节线上可以进入调整模式
        // 判断是否在小节轴上
        if (e.offsetY < parent.timeBar.height >> 1) {
            parent.timeBar.classList.remove('selecting');
            this.belongID = -1;
            return;
        }
        const timeNow = (e.offsetX + parent.scrollX) * parent.TperP;
        const m = this.beats.getMeasure(timeNow, true);
        if (m == null) {
            this.belongID = -1;
            parent.timeBar.classList.remove('selecting');
            return;
        }
        const threshold = 6 * parent.TperP;
        if (timeNow - m.start < threshold) {
            this.belongID = m.id - 1;
            parent.timeBar.classList.add('selecting');
        } else if (m.start + m.interval - timeNow < threshold) {
            this.belongID = m.id;
            parent.timeBar.classList.add('selecting');
        } else {
            this.belongID = -1;
            parent.timeBar.classList.remove('selecting');
        }
    };
}