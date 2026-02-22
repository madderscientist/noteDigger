function _ChordBar(parent) {
    this.chords = null; // [{at, chord}]
    this.update = () => {
        if (!this.chords) return;
        const canvas = parent.layers.action;
        const ctx = canvas.ctx;
        let x = 0; {
            let left = 0, right = this.chords.length - 1;
            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (this.chords[mid].at < parent.idXstart) {
                    x = mid;
                    left = mid + 1;
                } else right = mid - 1;
            }
        }
        const fill1Start = [], fill2Start = [];
        for (; x < this.chords.length && this.chords[x].at < parent.idXend; x++) {
            if (this.chords[x].chord === 'N') continue;
            let f = x & 1 ? fill1Start : fill2Start;
            let xstart = Math.max(0, this.chords[x].at * parent._width - parent.scrollX);
            let xend = Math.min(canvas.width, (this.chords[x + 1]?.at ?? parent.xnum) * parent._width - parent.scrollX);
            f.push({ xstart, xend, chord: this.chords[x].chord });
        }
        let ystart = canvas.height - parent._height;
        ctx.fillStyle = '#8400ff55';
        for (const { xstart, xend, chord } of fill1Start)
            ctx.fillRect(xstart, ystart, xend - xstart, parent._height);
        ctx.fillStyle = '#dd00ff55';
        for (const { xstart, xend, chord } of fill2Start)
            ctx.fillRect(xstart, ystart, xend - xstart, parent._height);
        ctx.fillStyle = 'black';
        ystart = canvas.height - 1;
        for (const { xstart, xend, chord } of fill1Start)
            ctx.fillText(chord, xstart, ystart);
        for (const { xstart, xend, chord } of fill2Start)
            ctx.fillText(chord, xstart, ystart);
    };
}