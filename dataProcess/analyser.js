class NoteAnalyser {    // 负责解析频谱数据
    static freqTable(A4) {
        const freqTable = new Float32Array(84);  // 范围是C1-B7
        let Note4 = [
            A4 * 0.5946035575013605, A4 * 0.6299605249474366,
            A4 * 0.6674199270850172, A4 * 0.7071067811865475,
            A4 * 0.7491535384383408,
            A4 * 0.7937005259840998, A4 * 0.8408964152537146,
            A4 * 0.8908987181403393, A4 * 0.9438743126816935,
            A4, A4 * 1.0594630943592953,
            A4 * 1.122462048309373
        ];
        freqTable.set(Note4.map(v => v / 8), 0);
        freqTable.set(Note4.map(v => v / 4), 12);
        freqTable.set(Note4.map(v => v / 2), 24);
        freqTable.set(Note4, 36);
        freqTable.set(Note4.map(v => v * 2), 48);
        freqTable.set(Note4.map(v => v * 4), 60);
        freqTable.set(Note4.map(v => v * 8), 72);
        return freqTable;
    }
    constructor(df, A4 = 440) {
        this.df = df;
        this.A4 = A4;   // 中央A频率
        this.freqTable = null;  // 频率表
    }
    set A4(fre) {
        this.freqTable = NoteAnalyser.freqTable(fre);
        this.updateRange();
    }
    get A4() {
        return this.freqTable[45];
    }
    updateRange() {
        let at = Array.from(this.freqTable.map((value) => Math.round(value / this.df)));
        at.push(Math.round((this.freqTable[this.freqTable.length - 1] * 1.059463) / this.df))
        const range = new Float32Array(84); // 第i个区间的终点
        for (let i = 0; i < at.length - 1; i++) {
            range[i] = (at[i] + at[i + 1]) / 2;
        } this.rangeTable = range;
    }
    /**
     * 从频谱提取音符的频谱 原理是区间内求和
     * @param {Float32Array} real 实部
     * @param {Float32Array} imag 虚部
     * @returns {Float32Array} 音符的幅度谱 数据很小
     */
    analyse(real, imag) {
        const noteAm = new Float32Array(84);
        let at = this.rangeTable[0];
        for (let i = 0; i < this.rangeTable.length; i++) {
            let end = this.rangeTable[i];
            if(at==end) {   // 如果相等则就算一次 乘法比幂运算快
                noteAm[i] = real[at] * real[at] + imag[at] * imag[at];
            } else {
                for (; at < end; at++) {
                    noteAm[i] += real[at] * real[at] + imag[at] * imag[at];
                }
                if (at == end) {  // end是整数，需要对半分
                    let a2 = (real[end] * real[end] + imag[end] * imag[end]) / 2;
                    noteAm[i] += a2;
                    if (i < noteAm.length - 1) noteAm[i + 1] += a2;
                }
            }
            // FFT的结果需要除以N才是DTFT的结果
            noteAm[i] = Math.sqrt(noteAm[i])/real.length;
        } return noteAm;
    }
}