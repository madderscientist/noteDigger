/**
 * 对midi事件进行封装
 * 相比于原生midi事件：
 * - 使用绝对时间（在导出为二进制时被mtrk转换为相对时间）
 * - 不记录通道信息（在导出为二进制时由mtrk加上通道信息）
 */
class midiEvent {
    ticks;  // 无需是整数 因为export时会被mtrk.tick_hex转为整数
    code;   // 必须是整数 由构造函数保证，但不限制范围
    value;  // 每一项必须是整数 由构造函数保证，但不限制范围
    // 范围的限制由static方法保证
    /**
     * 用参数创建一个事件
     * @param {number} ticks 绝对时间，单位tick。若tisks == -1, 在mtrk.addEvent时会自动使用last_tick; 若<-1, 则last_tick - this.ticks（此时代表相对时间）
     * @param {number} code 如果有channel，则去掉channel，如0x91 -> 0x9；如果是0xf0则保留此编码；如果是0xff则需要加上后面的type，如0xff51
     * @param {Array<number>} value 数组，代表其余所有参数
     */
    #constructor_args(ticks, code, value) {
        this.ticks = ticks;
        this.code = code;
        if (value instanceof Number) this.value = [value];
        else this.value = value;
        return this;
    }
    /**
     * 根据已经创建的对象创建事件
     * @param {Object} eventObj 一个对象，包含ticks, code, value
     * @param {boolean} reference 是否引用 默认true
     */
    #constructor_obj(eventObj, reference = true) {
        if (reference) {
            if (eventObj instanceof midiEvent) return eventObj;
            Object.setPrototypeOf(eventObj, midiEvent.prototype);
            return eventObj;
        } else {
            this.ticks = eventObj.ticks;
            this.code = eventObj.code;
            this.value = eventObj.value;
            return this;
        }
    }
    /**
     * 根据参数数目选择不同的构造函数创建事件。会把非整数转为整数
     * @param 参考构造函数#constructor_args和#constructor_obj
     * @returns midiEvent
     */
    constructor() {
        let e = (arguments.length == 3) ? this.#constructor_args(...arguments) : this.#constructor_obj(...arguments);
        // 数据整数化
        for (let i = 0; i < e.value.length; i++) e.value[i] = Math.round(e.value[i]);
        e.code = e.code | 0;
        return e;
    }
    /**
     * 针对0xff事件的type
     * code存的是0xff<<8+type，所以type是code的低8位
     */
    get type() {
        if (this.code >= 0xff) return this.code & 0xff;
        return void 0;
    }
    /**
     * 导出为二进制数据，要求this.ticks是绝对时间（非负数）
     * 应由mtrk调用，可以保证this.ticks是绝对时间（调用mtrk.addEvent时会转换相对为绝对）
     * @param {number} current_tick 本事件发生前的时间
     * @param {number} channel midi通道，对0xff??和0xf0事件无效
     * @returns {Array<number>} midi二进制数据数组的数组
     */
    export(current_tick = 0, channel = 0) {
        const d = mtrk.tick_hex(this.ticks - current_tick);
        if (this.code >= 0xf0) {
            if (this.code == 0xf0) d.push(0xf0, this.value.length);
            else d.push(0xff, this.type, this.value.length);
        } else d.push((this.code << 4) + channel);
        d.push(...this.value);
        return d;
    }

    static note(at, duration, note, intensity) {
        if (note < 0 || note > 127) {
            if (midi.autoFix) note = mtrk.constrain(note, 0, 127);
            else throw new Error('note should be in [0, 127]');
        }
        if (intensity < 0 || intensity > 127) {
            if (midi.autoFix) intensity = mtrk.constrain(intensity, 0, 127);
            else throw new Error('note intensity should be in [0, 127]');
        }
        return [new midiEvent({
            ticks: at,
            code: 0x9,
            value: [note, intensity]
        }), new midiEvent({
            ticks: at >= 0 ? at + duration : -duration,
            code: 0x9,
            value: [note, 0]
        })];
    }
    static instrument(at, instrument) {
        if (instrument < 0 || instrument > 127) {
            if (midi.autoFix) instrument = mtrk.constrain(instrument, 0, 127);
            else throw new Error('instrument should be in [0, 127]');
        }
        return new midiEvent({
            ticks: at,
            code: 0xc,
            value: [instrument]
        });
    }
    static control(at, id, Value) {
        return new midiEvent({
            ticks: at,
            code: 0xb,
            value: [id, Value]
        });
    }
    static tempo(at, bpm) {
        bpm = Math.round(60000000 / bpm);
        return new midiEvent({
            ticks: at,
            code: 0xff51,
            value: mtrk.number_hex(bpm, 3)
        });
    }
    static time_signature(at, numerator, denominator) {
        return new midiEvent({
            ticks: at,
            code: 0xff58,
            value: [numerator, Math.floor(Math.log2(denominator)), 0x18, 0x8]
        });
    }
    /**
     * 切换端口，以实现超过16个音轨
     * 一般不需要手动调用，在mtrk.export时会自动判断与调用
     * @param {number} port 
     * @returns {midiEvent}
     */
    static port(port = 0) {
        return new midiEvent({
            ticks: 0,   // 这种事件一定得发生在第一个
            code: 0xff21,
            value: [port]
        });
    }
}
// 一个音轨
class mtrk {
    // 限制数据范围
    static constrain(value, min = 0, max = 127) { return Math.min(max, Math.max(min, value)); }
    /**
     * 将tick数转换为midi的时间格式
     * @param {number} ticknum float，但会转换为int
     * @returns midi tick array
     * @example mtrk.tick_hex(555555) // [0x08, 0x7A, 0x23]
     */
    static tick_hex(ticknum) {
        ticknum = Math.round(ticknum).toString(2);
        let i = ticknum.length, j = Math.ceil(i / 7) * 7;
        for (; i < j; i++) ticknum = '0' + ticknum;
        const t = Array();
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
        const Buffer = Array(x > 0 ? x : str.length).fill(0);
        const len = Math.min(Buffer.length, str.length);
        for (let i = 0; i < len; i++) Buffer[i] = str[i].charCodeAt();
        return Buffer;
    }
    /**
     * 将一个正整数按16进制拆分成各个位放在数组中, 最低位在数组最高位
     * @param {number} num float，但会转换为int
     * @param {number} x array's length (default:self-adaption)
     * @returns array
     * @example mtrk.number_hex(257,5) // [0,0,0,1,1]
     */
    static number_hex(num, x = -1) {
        num = Math.round(num);
        if (x > 0) {
            let Buffer = Array(x).fill(0);
            for (--x; x >= 0 && num != 0; x--) {
                Buffer[x] = num & 0xff;
                num = num >> 8;
            } return Buffer;
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
            } return Buffer;
        }
    }
    constructor(name = "", event_list = Array()) {
        this.name = name;
        this.events = event_list;
        this.last_tick = 0; // 最后一个事件的时间
    }
    /**
     * 向mtrk添加事件 可以传入数组或一个个传递
     * @param {midiEvent || Object} event {ticks,code,value} 可以是midiEvent对象，也可以是一般对象（会转为midiEvent）
     * @returns event (or event list, or event list nesting)
     * @example m.addEvent({ticks:0,code:0x9,value:[40,100]}); m.addEvent(midiEvent.tempo(0,120));
     */
    addEvent(event) {
        if (arguments.length > 1) event = Array.from(arguments);
        const addevent = (e) => {
            if (e.ticks < 0) {
                if (e.ticks == -1)
                    e.ticks = this.last_tick;
                else
                    e.ticks = this.last_tick - e.ticks;
            }
            this.events.push(new midiEvent(e));
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
     * 其余同时事件将code大的排在前面
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
        let data = [];
        if (this.name.length) {
            data = mtrk.string_hex(this.name);
            data = [0, 255, 3, data.length, ...data];
        }
        // 多于16轨的支持
        let channel = track_id % 16;
        let port = track_id >> 4;
        if (port > 0) {
            data.push(...midiEvent.port(port).export(0, 0));
        }
        // 事件解析
        let current = 0;
        for (let i = 0; i < this.events.length; i++) {
            let temp = this.events[i];
            data.push(...temp.export(current, channel));
            current = Math.round(temp.ticks);   // 避免误差累积 tick_hex用的是round
        }
        return [77, 84, 114, 107].concat(
            mtrk.number_hex(data.length + 4, 4),
            data,
            0, 255, 47, 0
        );
    }

    /**
     * 将音轨转为可JSON对象
     * @param {number} track_id 音轨所属轨道id (从0开始)
     * @returns json object
     */
    JSON(track_id) {
        this.sort();
        const Notes = [],
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
                default:    // 0xffxx
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

class midi {
    static autoFix = false; // 是否自动修正异常数据；为false会抛出异常
    /**
     * midi文件，组织多音轨
     * @param {number} bpm beats per minute
     * @param {Array<number>} time_signature [numerator, denominator] 4/4 -> [4,4]
     * @param {number} tick default 480
     * @param {Array<mtrk>} Mtrk initial with exist mtrk list
     * @param {string} Name midi file name
     */
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
    addTrack(newtrack = null, channel_id = -1) {
        if (newtrack == null)
            newtrack = new mtrk(String(this.Mtrk.length));
        if (channel_id >= 0) {
            if (channel_id < this.Mtrk.length) this.Mtrk.splice(channel_id, 0, newtrack);
            else this.Mtrk[channel_id] = newtrack;
        } else this.Mtrk.push(newtrack);
        return newtrack;
    }
    get tracks() {  // 起个别名
        return this.Mtrk;
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
     * 由于设计时认为同一音轨只操控一个通道，因此对于一个音轨操作多个通道的midi文件会有改动
     * @param {Uint8Array} midi_file midi数据
     * @param {boolean} which_main 1则以音轨为主，把同一音轨的通道置为相同；2则通道为主，一个通道一个音轨；0则根据midi类型判断，midi1则音轨为主，midi0则通道为主。最终都是保证一个音轨对应一个通道
     * @returns new midi object
     */
    static import(midi_file, which_main = 0) {
        // 判断是否为midi文件
        if (midi_file.length < 14) return null;
        if (midi_file[0] != 77 || midi_file[1] != 84 || midi_file[2] != 104 || midi_file[3] != 100) return null;
        let newmidi = new midi(120, [4, 4], 480, [new mtrk('0')], '');  // 第一轨放全局控制事件
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
            let midiPort = 0;       // 默认的端口号
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
                let ichannel = n;
                switch (which_main) {
                    case 1:
                        ichannel = n;
                        break;
                    case 2:
                        ichannel = (midiPort << 4) + channel;
                        break;
                    default:
                        ichannel = (midtype == 0) ? ((midiPort << 4) + channel) : n;
                        break;
                }
                if (!newmidi.Mtrk[ichannel]) newmidi.addTrack(new mtrk(), ichannel);
                do {
                    flag = false;
                    switch (type) { // 结束后指向事件的最后一个字节
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
                                    case 0x21:
                                        midiPort = midi_file[i + 1];
                                        break;
                                //== 不break，进入default添加事件。所以这后面的都要加`if(timeline == 0)`保证能到default ==//
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
                                    default:    // 没有通道的统一加到第一轨
                                        newmidi.Mtrk[0].addEvent({
                                            ticks: timeline,
                                            code: (0xff << 8) + midi_file[i - 1],
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
        // 移除除了第一轨以外的空音轨（没有音符的音轨）
        for (let i = 1; i < newmidi.Mtrk.length; i++) {
            let temp = newmidi.Mtrk[i];
            if (!temp) continue;
            temp = temp.events;
            let hasNote = false;
            for (let j = 0; j < temp.length; j++) {
                if (temp[j].code == 0x9) {
                    hasNote = true;
                    break;
                }
            }
            if (!hasNote) newmidi.Mtrk[i] = void 0;
        }
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
            const data = [
                [77, 84, 104, 100, 0, 0, 0, 6, 0, 1],
                undefined,  // 通道数 之后再填，因为数组可能空洞
                mtrk.number_hex(this.tick, 2)
            ];
            // 加入全局音轨
            let headMtrk = new mtrk("head", [
                midiEvent.tempo(0, this.bpm),
                midiEvent.time_signature(0, this.time_signature[0], this.time_signature[1])
            ]);
            data.push(headMtrk.export(0));
            // 加入其余音轨
            let realChannelNum = 1;
            for (let i = 0; i < this.Mtrk.length; i++) {
                if (this.Mtrk[i]) {
                    data.push(this.Mtrk[i].export(i));
                    realChannelNum++;
                }
            }
            data[1] = mtrk.number_hex(realChannelNum, 2);
            return new Uint8Array([].concat(...data));
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
            if (!this.Mtrk[i]) continue;
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