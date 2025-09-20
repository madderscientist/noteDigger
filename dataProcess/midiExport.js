var _midiExport = {
    UI() {
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = `
    <div class="request-cover">
        <div class="card hvCenter" style="overflow: visible;"><label class="title">导出为midi</label>
            <div class="layout"><button class="ui-confirm labeled" data-tooltip="可用于制谱；可能会损失、扭曲一些信息">导出时节奏对齐</button></div>
            <div class="layout"><button class="ui-confirm labeled" data-tooltip="保证播放起来和这里一模一样，但丢失节奏信息">和听起来一样</button></div>
            <div class="layout"><button class="ui-cancel">取消</button></div>
        </div>
    </div>`;
        const card = tempDiv.firstElementChild;
        const close = () => { card.remove(); };
        const btns = card.querySelectorAll('button');
        btns[0].onclick = () => {
            const midi = _midiExport.beatAlign();
            bSaver.saveArrayBuffer(midi.export(1), midi.name + '.mid');
            close();
        };
        btns[1].onclick = () => {
            const midi = _midiExport.keepTime();
            bSaver.saveArrayBuffer(midi.export(1), midi.name + '.mid');
            close();
        };
        btns[2].onclick = close;
        document.body.insertBefore(card, document.body.firstChild);
        card.tabIndex = 0;
        card.focus();
    },
    /**
     * 100%听感还原扒谱结果，但节奏是乱的
     */
    keepTime() {
        const accuracy = 10;
        const newMidi = new midi(60, [4, 4], Math.round(1000 * accuracy / app.dt), [], app.AudioPlayer.name);
        const mts = [];
        for (const ch of app.synthesizer.channel) {
            let mt = newMidi.addTrack();
            mt.addEvent(midiEvent.instrument(0, ch.instrument));
            mt._volume = ch.volume;
            mts.push(mt);
        }
        for (const nt of app.MidiAction.midi) {
            const midint = nt.y + 24;
            let v = mts[nt.ch]._volume;
            if (nt.v) v = Math.min(127, v * nt.v / 127);
            mts[nt.ch].addEvent(midiEvent.note(nt.x1 * accuracy, (nt.x2 - nt.x1) * accuracy, midint, v));
        } return newMidi;
    },
    beatAlign() {
        // 初始化midi
        let begin = app.BeatBar.beats[0];
        let lastbpm = begin.bpm;    // 用于自适应bpm
        const newMidi = new midi(lastbpm, [begin.beatNum, begin.beatUnit], 480, [], app.AudioPlayer.name);
        const mts = [];
        for (const ch of app.synthesizer.channel) {
            let mt = newMidi.addTrack();
            mt.addEvent(midiEvent.instrument(0, ch.instrument));
            mt._volume = ch.volume;
            mts.push(mt);
        }
        // 将每个音符拆分为两个时刻
        const Midis = app.MidiAction.midi;
        const mlen = Midis.length << 1;
        const moment = new Array(mlen);
        for (let i = 0, j = 0; i < mlen; j++) {
            const nt = Midis[j];
            let duration = nt.x2 - nt.x1;
            let midint = nt.y + 24;
            let v = mts[nt.ch]._volume;
            if (nt.v) v = Math.min(127, v * nt.v / 127);
            moment[i++] = new midiEvent({
                _d: duration,
                ticks: nt.x1,
                code: 0x9,
                value: [midint, v],
                _ch: nt.ch
            }, true);
            moment[i++] = new midiEvent({
                _d: duration,
                ticks: nt.x2,
                code: 0x9,
                value: [midint, 0],
                _ch: nt.ch
            }, true);
        } moment.sort((a, b) => a.ticks - b.ticks);
        // 对每个小节进行对齐
        let m_i = 0;    // moment的指针
        let tickNow = 0;    // 维护总时长
        for (const measure of app.BeatBar.beats) {
            if (m_i == mlen) break;

            //== 判断bpm是否变化 假设小节之间bpm相关性很强 ==//
            const bpmnow = measure.bpm;
            if (Math.abs(bpmnow - lastbpm) > lastbpm * 0.065) {
                mts[0].events.push(midiEvent.tempo(tickNow, bpmnow * 4 / measure.beatUnit));
            } lastbpm = bpmnow;

            //== 对齐音符 ==//
            const begin = measure.start / app.dt;   // 转换为以“格”为单位
            const end = (measure.interval + measure.start) / app.dt;
            // 一个八音符的格数
            const aot = measure.interval * measure.beatUnit / (measure.beatNum * 8 * app.dt);
            while (m_i < mlen) {
                const n = moment[m_i];
                if (n.ticks > end) break;    // 给下一小节
                const threshold = n._d / 2;
                let accuracy = aot;
                while (accuracy > threshold) accuracy /= 2;
                n.ticks = tickNow + ((Math.round((n.ticks - begin) / accuracy) * newMidi.tick * accuracy / aot) >> 1);
                mts[n._ch].events.push(n);
                m_i++;
            } tickNow += newMidi.tick * measure.beatNum * 4 / measure.beatUnit;
        } return newMidi;
    }
}
