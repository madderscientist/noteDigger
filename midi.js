// 封装二进制事件
class midiEvent {
    // 若tisks == -1, 在addEvent时会自动使用last_tick; 若<-1, 则last_tick - this.ticks
    static note(at, duration, note, intensity) {
        return [{
            ticks: at,
            code: 0x9,
            value: [note, intensity]
        }, {
            ticks: at >= 0 ? at + duration : -duration,
            code: 0x9,
            value: [note, 0]
        }];
    }
    static instrument(at, instrument) {
        return {
            ticks: at,
            code: 0xc,
            value: [instrument]
        };
    }
    static control(at, id, Value) {
        return {
            ticks: at,
            code: 0xb,
            value: [id, Value]
        };
    }
    static tempo(at, bpm) {
        bpm = Math.round(60000000 / bpm);
        return {
            ticks: at,
            code: 0xff,
            type: 0x51,
            value: mtrk.number_hex(bpm, 3)
        };
    }
    static time_signature(at, numerator, denominator) {
        return {
            ticks: at,
            code: 0xff,
            type: 0x58,
            value: [numerator, Math.floor(Math.log2(denominator)), 0x18, 0x8]
        };
    }
}
// 一个音轨
class mtrk {
    /**
     * 将tick数转换为midi的时间格式
     * @param {number} ticknum int
     * @returns midi tick array
     * @example mtrk.tick_hex(555555) // [0x08, 0x7A, 0x23]
     */
    static tick_hex(ticknum) {
        ticknum = ticknum.toString(2);
        let i = ticknum.length, j = Math.ceil(i / 7) * 7;
        for (; i < j; i++) ticknum = '0' + ticknum;
        let t = Array();
        for (i = 0; i + 7 < j; i = i + 7) t.push('1' + ticknum.substring(i, i + 7));
        t.push('0' + ticknum.substr(-7, 7));
        for (i = 0; i < t.length; i++) t[i] = parseInt(t[i], 2);
        return t;
    }
    /**
     * 将字符串转换为ascii数组
     * @param {string} name string
     * @param {number} x array's length (default:self-adaption)
     * @returns array
     * @example mtrk.string_hex("example",3) // [101,120,97]
     */
    static string_hex(str, x = -1) {
        let Buffer = Array(x > 0 ? x : str.length).fill(0);
        let len = Math.min(Buffer.length, str.length);
        for (let i = 0; i < len; i++) Buffer[i] = str[i].charCodeAt();
        return Buffer;
    }
    /**
     * 将一个正整数按16进制拆分成各个位放在数组中, 最地位在数组最高位
     * @param {number} num int
     * @param {number} x array's length (default:self-adaption)
     * @returns array
     * @example mtrk.number_hex(257,5) // [0,0,0,1,1]
     */
    static number_hex(num, x = -1) {
        if (x > 0) {
            let Buffer = Array(x).fill(0);
            for (--x; x >= 0 && num != 0; x--) {
                Buffer[x] = num & 0xff;
                num = num >> 8;
            }
            return Buffer;
        } else {
            let len = 0;
            let num2 = num;
            while (num2 != 0) {
                num2 = num2 >> 8;
                len++;
            }
            let Buffer = Array(len);
            for (--len; len >= 0; len--) {
                Buffer[len] = num & 0xff;
                num = num >> 8;
            }
            return Buffer;
        }
    }
    constructor(name = "untitled", event_list = Array()) {
        this.name = name;
        this.events = event_list;
        this.last_tick = 0; // 最后一个事件的时间
    }
    /**
     * 向mtrk添加事件
     * @param {object} event {ticks,code,*[type],value}
     * @returns event (or event list, or event list nesting)
     * @example m.addEvent({ticks:0,code:0x9,value:[40,100]}); m.addEvent(midiEvent.tempo(0,120));
     */
    addEvent(event) {
        const addevent = (e) => {
            if (e.ticks < 0) {
                if (e.ticks == -1)
                    e.ticks = this.last_tick;
                else
                    e.ticks = this.last_tick - e.ticks;
            }
            this.events.push(e);
            if (e.ticks > this.last_tick)
                this.last_tick = e.ticks;
        }
        const parseEvents = (el) => {
            if (Array.isArray(el)) {
                for (let i = 0; i < el.length; i++)
                    parseEvents(el[i]);
            } else addevent(el);
        }
        parseEvents(event);
        return event;
    }
    /**
     * 对齐事件
     * @param {number} tick 一个四分音符的tick数
     * @param {number} accuracy int, 精度, 越大允许的最短时长越小
     */
    align(tick, accuracy = 4) {
        accuracy = tick / parseInt(accuracy);
        for (let i = 0; i < this.events.length; i++) {
            this.events[i].ticks = Math.round(this.events[i].ticks / accuracy) * accuracy;
        }
    }
    /**
     * 事件按时间排序，同时间的音符事件则按力度排序
     */
    sort() {
        this.events.sort((a, b) => {
            if(a.ticks == b.ticks) {
                if(a.code == b.code && a.code == 9) return a.value[1] - b.value[1];
                return b.code - a.code;
            } return a.ticks - b.ticks;
        });
    }
    /**
     * 将mtrk转换为track_id音轨上的midi数据
     * @param {number} track_id int, [0, 15]
     * @returns Array
     */
    export(track_id) {
        this.sort();
        // 音轨名
        let data = mtrk.string_hex(this.name);
        data = [0, 255, 3, data.length, ...data];
        // 事件解析
        let current = 0;
        for (let i = 0; i < this.events.length; i++) {
            let temp = this.events[i];
            let d = null;
            if (temp.code >= 0xf0) {
                if (temp.code == 0xf0) d = [0xf0, temp.value.length];
                else d = [0xff, temp.type, temp.value.length];
            } else d = (temp.code << 4) + track_id;
            data = data.concat(mtrk.tick_hex(temp.ticks - current), d, temp.value);
            current = temp.ticks;
        }
        return [77, 84, 114, 107,
            ...mtrk.number_hex(data.length + 4, 4),
            ...data,
            0, 255, 47, 0];
    }

    /**
     * 将音轨转为可JSON对象
     * @param {number} track_id 音轨所属轨道id (从0开始)
     * @returns json object
     */
    JSON(track_id) {
        this.sort();
        let Notes = [],
            controls = [],
            Instruments = [],
            Tempos = [],
            TimeSignatures = [];
        for (let i = 0; i < this.events.length; i++) {
            let temp = this.events[i];
            switch (temp.code) {
                case 0x9:
                    if (temp.value[1] > 0) {    // 力度不为0表示按下
                        let overat = temp.ticks;
                        for (let j = i + 1; j < this.events.length; j++) {
                            let over = this.events[j];
                            if (over.code == 0x9 && over.value[0] == temp.value[0]) {
                                overat = over.ticks;
                                if (overat > temp.ticks) {
                                    Notes.push({
                                        ticks: temp.ticks,
                                        durationTicks: overat - temp.ticks,
                                        midi: temp.value[0],
                                        intensity: temp.value[1]
                                    });
                                    break;
                                }
                            }
                        }
                    }
                    break;
                case 0xb:
                    controls.push({
                        ticks: temp.ticks,
                        controller: temp.value[0],
                        value: temp.value[1]
                    })
                    break;
                case 0xc:
                    Instruments.push({
                        ticks: temp.ticks,
                        number: temp.value[0]
                    });
                    break;
                case 0xff:
                    switch (temp.type) {
                        case 0x51:  // 速度
                            Tempos.push({
                                ticks: temp.ticks,
                                bpm: Math.round(60000000 / ((temp.value[0] << 16) + (temp.value[1] << 8) + temp.value[2]))
                            });
                            break;
                        case 0x58:  // 节拍
                            TimeSignatures.push({
                                ticks: temp.ticks,
                                timeSignature: [temp.value[0], 2 << temp.value[1]]
                            });
                            break;
                    }
                    break;
            }
        }
        return {
            channel: track_id,
            name: this.name,
            tempos: Tempos,
            controlChanges: controls,
            instruments: Instruments,
            notes: Notes,
            timeSignatures: TimeSignatures
        }
    }
    toJSON(track_id) {
        return this.JSON(track_id);
    }
}
// midi文件，组织多音轨
class midi {
    constructor(bpm = 120, time_signature = [4, 4], tick = 480, Mtrk = [], Name = 'untitled') {
        this.bpm = bpm;
        this.Mtrk = Mtrk;   // Array<mtrk>
        this.tick = tick;   // 一个四分音符的tick数
        this.time_signature = time_signature;
        this.name = Name;
    }
    /**
     * 添加音轨，如果无参则创建并返回
     * @param {mtrk} newtrack
     * @returns mtrk
     * @example track = m.addTrack(); m2.addTrack(new mtrk("test"))
     */
    addTrack(newtrack = null) {
        if (newtrack == null)
            newtrack = new mtrk(String(this.Mtrk.length));
        this.Mtrk.push(newtrack);
        return newtrack;
    }
    /**
     * 对齐所有音轨 修改自身
     * @param {number} accuracy 对齐精度
     */
    align(accuracy = 4) {
        for (let i = 0; i < this.Mtrk.length; i++)
            this.Mtrk[i].align(this.tick, accuracy);
    }
    /**
     * 解析midi文件，返回新的midi对象
     * @param {Uint8Array} midi_file midi数据
     * @returns new midi object
     */
    static import(midi_file) {
        // 判断是否为midi文件
        if (midi_file.length < 14) return null;
        if (midi_file[0] != 77 || midi_file[1] != 84 || midi_file[2] != 104 || midi_file[3] != 100) return null;
        let newmidi = new midi(120, [4, 4], 480, Array.from({ length: 16 }, (_, i) => new mtrk(String(i))), '');
        // 读取文件头
        newmidi.tick = midi_file[13] + (midi_file[12] << 8);
        let mtrkNum = midi_file[11] + (midi_file[10] << 8);
        let midtype = midi_file[9];
        // 读mtrk音轨
        for (let n = 0, i = 14; n < mtrkNum; n++) {
            // 判断是否为MTrk音轨
            if (midi_file[i++] != 77 || midi_file[i++] != 84 || midi_file[i++] != 114 || midi_file[i++] != 107) { n--; i -= 3; continue; }
            let timeline = 0;       // 时间线
            let lastType = 0xC0;	// 上一个midi事件类型
            let lastChaneel = n - 1;  // 上一个midi事件通道
            let mtrklen = (midi_file[i++] << 24) + (midi_file[i++] << 16) + (midi_file[i++] << 8) + midi_file[i++] + i;
            // 读取事件
            for (; i < mtrklen; i++) {
                // 时间间隔(tick)
                let flag = 0;
                while (midi_file[i] > 127)
                    flag = (flag << 7) + midi_file[i++] - 128;
                timeline += (flag << 7) + midi_file[i++];
                // 事件类型
                let type = midi_file[i] & 0xf0;
                let channel = midi_file[i++] - type;
                let ichannel = midtype ? n : channel;
                do {
                    flag = false;
                    switch (type) { //结束后指向事件的最后一个字节
                        case 0x90:	// 按下音符
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0x9,
                                value: [midi_file[i++], midi_file[i]]
                            });
                            break;
                        case 0x80:	// 松开音符
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0x9,
                                value: [midi_file[i++], 0]
                            });
                            break;
                        case 0xF0:	// 系统码和其他格式
                            if (channel == 0xF) {
                                switch (midi_file[i++]) {
                                    case 0x2f:
                                        break;
                                    case 0x03:
                                        // 给当前mtrk块同序号的音轨改名
                                        newmidi.Mtrk[n].name = '';
                                        for (let q = 1; q <= midi_file[i]; q++)
                                            newmidi.Mtrk[n].name += String.fromCharCode(midi_file[i + q]);
                                        break;
                                    case 0x58:
                                        if (timeline == 0) {
                                            newmidi.time_signature = [midi_file[i + 1], 1 << midi_file[i + 2]];
                                            break;
                                        }
                                    case 0x51:
                                        if (timeline == 0) {
                                            newmidi.bpm = Math.round(60000000 / ((midi_file[i + 1] << 16) + (midi_file[i + 2] << 8) + midi_file[i + 3]));
                                            break;
                                        }
                                    default:
                                        newmidi.Mtrk[0].addEvent({
                                            ticks: timeline,
                                            code: 0xff,
                                            type: midi_file[i - 1],
                                            value: Array.from(midi_file.slice(i + 1, i + 1 + midi_file[i]))
                                        });
                                        break;
                                }
                            } else {	// 系统码
                                newmidi.Mtrk[0].addEvent({
                                    ticks: timeline,
                                    code: 0xf0,
                                    value: Array.from(midi_file.slice(i + 1, i + 1 + midi_file[i]))
                                });
                            }
                            i += midi_file[i];
                            break;
                        case 0xB0:	// 控制器
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0xb,
                                value: [midi_file[i++], midi_file[i]]
                            });
                            break;
                        case 0xC0:	// 改变乐器
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0xc,
                                value: [midi_file[i]]
                            });
                            break;
                        case 0xD0:	// 触后通道
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0xd,
                                value: [midi_file[i]]
                            });
                            break;
                        case 0xE0:	// 滑音
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0xe,
                                value: [midi_file[i++], midi_file[i]]
                            });
                            break;
                        case 0xA0:	// 触后音符
                            newmidi.Mtrk[ichannel].addEvent({
                                ticks: timeline,
                                code: 0xa,
                                value: [midi_file[i++], midi_file[i]]
                            });
                            break;
                        default:
                            type = lastType;
                            channel = lastChaneel
                            flag = true;
                            i--;
                            break;
                    }
                } while (flag);
                lastType = type;
                lastChaneel = channel;
            }
        }
        newmidi.name = newmidi.Mtrk[0].name;
        // 找到第一个有音符的音轨
        mtrkNum = 0;
        for (let i = 1; i < newmidi.Mtrk.length; i++) {
            let temp = newmidi.Mtrk[i].events;
            for (let j = 0; j < temp.length; j++) {
                if (temp[j].code == 0x9) {
                    mtrkNum = i;
                    temp = null;
                    break;
                }
            }
            if (!temp) break;
        }
        // 把没有音符的音轨事件移到第一个有音符的音轨
        for (let i = 0; i < newmidi.Mtrk.length; i++) {
            let temp = newmidi.Mtrk[i].events;
            for (let j = 0; j < temp.length; j++) {
                if (temp[j].code == 0x9) {
                    temp = null;
                    break;
                }
            }
            if (temp) {
                newmidi.Mtrk[mtrkNum].events = newmidi.Mtrk[mtrkNum].events.concat(temp);
                newmidi.Mtrk[i] = null;
            }
        }
        // 删去空的音轨
        for (let i = 0; i < newmidi.Mtrk.length; i++)
            if (!newmidi.Mtrk[i] || newmidi.Mtrk[i].events.length == 0) newmidi.Mtrk.splice(i--, 1);
        return newmidi;
    }
    /**
     * 转换为midi数据
     * @param {*} type midi file type [0 or 1(default)]
     * @returns Uint8Array
     */
    export(type = 1) {
        if (type == 0) {    // midi0创建 由于事件不记录音轨，需要归并排序输出
            let Mtrks = Array(this.Mtrk.length + 1);
            for (let i = 0; i < this.Mtrk.length; i++) {
                this.Mtrk[i].sort();
                Mtrks[i] = this.Mtrk[i].events;
            }
            Mtrks[this.Mtrk.length] = new mtrk("head", [
                midiEvent.tempo(0, this.bpm),
                midiEvent.time_signature(0, this.time_signature[0], this.time_signature[1])
            ]);
            let current = 0;
            let index = Array(Mtrks.length).fill(0);
            let data = [];
            while (true) {
                // 找到ticks最小项
                let min = -1;
                let minticks = 0;
                for (let i = 0; i < index.length; i++) {
                    if (index[i] < Mtrks[i].length) {
                        if (min == -1 || Mtrks[i][index[i]].ticks < minticks) {
                            min = i;
                            minticks = Mtrks[i][index[i]].ticks;
                        }
                    }
                }
                if (min == -1) break;
                // 转为midi数据
                let d = null;
                let temp = Mtrks[min][index[min]];
                if (temp.code >= 0xf0) {
                    if (temp.code == 0xf0) d = [0xf0, temp.value.length];
                    else d = [0xff, temp.type, temp.value.length];
                } else d = (temp.code << 4) + min;
                data = data.concat(mtrk.tick_hex(temp.ticks - current), d, temp.value);
                // 善后
                current = minticks;
                index[min]++;
            }
            data = [0, 255, 3, 5, 109, 105, 100, 105, 48, ...data, 0, 255, 47, 0];  // 加了音轨名和结尾
            return new Uint8Array([
                77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, ...mtrk.number_hex(this.tick, 2),
                77, 84, 114, 107,
                ...mtrk.number_hex(data.length, 4),
                ...data
            ]);
        } else {    // 除了初始速度、初始节拍，其余ff事件全放0音轨。头音轨不在Mtrk中，export时生成
            // MThd创建
            let data = [77, 84, 104, 100, 0, 0, 0, 6, 0, 1, ...mtrk.number_hex(1 + this.Mtrk.length, 2), ...mtrk.number_hex(this.tick, 2)];
            // 加入全局音轨
            let headMtrk = new mtrk("head", [
                midiEvent.tempo(0, this.bpm),
                midiEvent.time_signature(0, this.time_signature[0], this.time_signature[1])
            ])
            data = data.concat(headMtrk.export(0));
            // 加入其余音轨
            for (let i = 0; i < this.Mtrk.length; i++)
                data = data.concat(this.Mtrk[i].export(i));
            return new Uint8Array(data);
        }
    }

    /**
     * 将midi转换为json对象。原理：每个音轨转换为json对象并对事件进行合并
     * @returns json object
     */
    JSON() {
        let j = {
            header: {
                name: this.name,
                tick: this.tick,
                tempos: [{
                    ticks: 0,
                    bpm: this.bpm
                }],
                timeSignatures: [{
                    ticks: 0,
                    timeSignature: this.time_signature
                }]
            },
            tracks: []
        }
        for (let i = 0; i < this.Mtrk.length; i++) {
            let t = this.Mtrk[i].JSON(i);
            j.header.tempos = j.header.tempos.concat(t.tempos);
            j.header.timeSignatures = j.header.timeSignatures.concat(t.timeSignatures);
            j.tracks.push({
                channel: t.channel,
                name: t.name,
                controlChanges: t.controlChanges,
                instruments: t.instruments,
                notes: t.notes
            });
        }
        return j;
    }
    toJSON() {
        return this.JSON();
    }
}

/**
 * 转换为番茄简谱脚本输出
 * @param {midi} mid 待转换的midi类
 * @param {*} barNum 几小节一行
 * @returns 
 */
function fanqie(mid, barNum = 4) {
    const fqnote = ["1", "1#", "2", "2#", "3", "4", "4#", "5", "5#", "6", "6#", "7"];
    const fqtime = ['////', '///', '//', '/', '-']
    var j = mid.JSON();
    let anote = j.header.tick;
    // 最长时间
    let maxtick = 0;
    for (let i = 0; i < j.tracks.length; i++) {
        let temp = j.tracks[i].notes;
        temp = temp[temp.length - 1];
        maxtick = Math.max(maxtick, temp.ticks + temp.durationTicks);
    }
    function indexTofq(index) {     //mid序号转番茄简谱音符
        index -= 60;
        let position = (index % 12 + 12) % 12;
        let k = Math.floor(index / 12);
        let brackets = '';
        for (let i = 0; i < Math.abs(k); i++) {
            brackets = brackets + "'";
        }
        return fqnote[position] + ((k > 0) ? brackets : brackets.replace(/\'/g, ","));
    }
    function atrack(t) {
        /* [tick, priority, text]
        音符结束    -1
        小节线      0       |
        节奏型      1       "p:?/?"
        音符开始    3
        速度标记    8       "bpm:"
        */
        let es = [];
        // 添加音符
        for (let i = 0; i < t.notes.length; i++) {
            let n = t.notes[i];
            let fqnote = indexTofq(n.midi);
            let start = [n.ticks, 3, fqnote, ''];   // 最后一位是前缀
            let end = [n.ticks + n.durationTicks, -1, fqnote];
            es.push(start, end);
        }
        // 添加拍号和小节号
        let temp = j.header.timeSignatures;
        for (let i = 0; i < temp.length; i++) {
            es.push([temp[i].ticks, 1, `"p:${temp[i].timeSignature[0]}/${temp[i].timeSignature[1]}"`]);
            let step = Math.round(anote * temp[i].timeSignature[0] / Math.pow(2, 2 - Math.log2(temp[i].timeSignature[1])));
            let endtick = temp[i + 1] ? temp[i + 1].ticks : maxtick;
            for (let k = temp[i].ticks + step; k <= endtick; k += step) {
                es.push([k, 0, '', '|']);    // 最后一位是前缀
            }
        }
        // 添加bpm
        if (t.channel == 0) {
            temp = j.header.tempos;
            for (let i = 0; i < temp.length; i++) {
                es.push([temp[i].ticks, 8, `"bpm:${temp[i].bpm}"`])
            }
        }
        es.sort((a, b) => {
            if (a[0] == b[0]) return a[1] - b[1];
            return a[0] - b[0];
        });
        // 重要前提：音符中无音符
        // 时值
        let lastid = -1;
        let lastnote = 0;
        let esi = 0;
        function TofqTime(time, note = 0) {
            time = Math.round(time * 16 / anote);
            let times = [];
            for (let i = 4; time > 0 && i >= 0; i--) {
                let x = 1 << i;
                while (time >= x) {
                    time -= x;
                    times.push(i);
                }
            }

            time = '';
            if (lastnote == 0) {   // 休止符不用关心如何合并
                for (let i = 0; i < times.length; i++)
                    if (times[i] == 4) time += '0';
                    else time += '0' + fqtime[times[i]];
            } else {
                if (times.length == 0) return null;
                // 优化成附点音符
                let dotted = [];
                let i = 0;
                for (; i < times.length - 1; i++) {
                    if (times[i] - times[i + 1] == 1) dotted.push(fqtime[times[i++]] + '.');
                    else dotted.push(fqtime[times[i]]);
                }
                if (i < times.length) dotted.push(fqtime[times[i]]);
                // 应该在es里面加一项，使小节线能加上括号
                // 1. 找到最后一项 2. 最后一项插入esi处，且lastid=esi,esi++ 3. 最后一项前缀为前面的时值，返回它的时值
                // 最后一项：1. 实际上的最后一项；2. 后面是‘-’；3. 此项为‘-.’
                function insertNote() {
                    es[lastid][2] = '(' + es[lastid][2];
                    es.splice(esi, 0, [es[esi][0], -1, lastnote + ')', time.substr(lastnote.length + 2)]);
                    lastid = esi++;
                }
                let count = 0;
                for (i = dotted.length - 1; i >= 0; i--) {
                    if (dotted[i] == '-.') {
                        if (count) insertNote(); // 一项以上
                        time = '.';
                        for (i--; i >= 0; i--) time += dotted[i];
                        break;
                    } else if (!dotted[i - 1]) {
                        if (count) {
                            insertNote();
                            time = '';
                        }
                        time += dotted[i].replace('-', '');
                        break;
                    } else if (dotted[i - 1] == '-') {
                        if (count) insertNote();
                        time = '';
                        for (i--; i >= 0; i--) time += dotted[i];
                        break;
                    } else {
                        time += '(' + lastnote + ')' + dotted[i];
                        count++;
                    }
                }
            }
            return time;
        }
        for (; esi < es.length; esi++) {
            if (es[esi][1] == 3) {        // 音符开始。
                // 如果lastnote==0，前面填充休止符; 如果上一个没结束，就结束上一个！
                es[esi][3] = TofqTime(es[esi][0] - (lastid == -1 ? 0 : es[lastid][0]));
                if (es[esi][3] == null) {  // 如果返回值为null，就把上一个清除
                    es[esi][3] = '';
                    es[lastid][2] = '';
                }
                lastid = esi;
                lastnote = es[esi][2];
            } else if (es[esi][1] == -1) {    // 音符结束
                if (lastnote == 0) es[esi][2] = '';  // 如果前面是空，则跳过这个
                else if (lastnote == es[esi][2]) {     // 如果lastnote和这个不一样，说明是被提前结束了的，跳过
                    es[esi][2] = TofqTime(es[esi][0] - es[lastid][0]);
                    lastid = esi;
                    lastnote = 0;
                }
            } else if (es[esi][1] == 0) {     // 小节线
                if (lastnote == 0) {    // 前面填充休止符
                    es[esi][3] = TofqTime(es[esi][0] - (lastid == -1 ? 0 : es[lastid][0])) + '|';
                } else {                // 结束上一个
                    es[esi][3] = TofqTime(es[esi][0] - es[lastid][0]);
                    if (es[esi][3] == null) {  // 上一个离小节线太近了，交换位置
                        es[esi][1] = es[lastid][1];
                        es[lastid][3] += '|';
                        es[esi][2] = es[lastid][2]
                        es[lastid][2] = '';
                        es[esi][3] = '';
                    } else {
                        // 上一个加(
                        es[lastid][2] = '(' + es[lastid][2];
                        // 这个改成【上一个的时值|note)】
                        es[esi][3] += '|';
                        es[esi][2] = lastnote + ')';
                    }
                }
                lastid = esi;
            }
        }
        temp = '';
        for (let i = 0; i < es.length; i++) {
            if (es[i].length == 4) {
                temp += es[i][3];
            }
            temp += es[i][2];
        }
        return temp;
    }
    // 开始转换
    let results = Array.from(j.tracks, x => atrack(x).split('|'));
    //脚本头
    let o = `B: ${j.header.name}\nZ: 佚名词曲\nD: C\n`;
    //拼接
    let linecount = 0;
    for (let i = 0; i < results[0].length; i += barNum) {   // 小节计数
        for (let k = 0; k < results.length; k++) {  // 对每一个音轨
            o += `Q${k + 1}: `;
            for (let p = 0; p < barNum && i + p < results[0].length; p++)
                o += '|' + results[k][i + p];
            o += '|\n';
            linecount++;
        }
        if (linecount % 14 == 0) o += '[fenye]\n';
    }
    return o;
}

