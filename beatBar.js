// 本文件用于管理小节信息，实现了稀疏存储小节的数据结构
class aMeasure {
    /**
     * 构造一个小节
     * @param {Number | aMeasure} beatNum 分子 几拍为一小节; 如果是aMeasure对象则复制构造
     * @param {Number} beatUnit 分母 几分音符是一拍
     * @param {Number} interval 一个小节的时间，单位ms
     */
    constructor(beatNum = 4, beatUnit = 4, interval = 2000) {
        if (typeof beatNum === 'number') {
            this.beatNum = beatNum;
            this.beatUnit = beatUnit;
            this.interval = interval;
        } else {    // 复制构造
            this.beatNum = beatNum.beatNum;
            this.beatUnit = beatNum.beatUnit;
            this.interval = beatNum.interval;
        }
    }
    static fromBpm(beatNum, beatUnit, bpm) {
        let interval = 60000 * beatNum / bpm;
        return new aMeasure(beatNum, beatUnit, interval);
    }
    copy(obj) {
        this.beatNum = obj.beatNum;
        this.beatUnit = obj.beatUnit;
        this.interval = obj.interval;
        return this;
    }
    // 不关注bpm，而关注interval。所以修改了beatNum会导致bpm变化
    get bpm() {
        return 60000 / this.interval * this.beatNum;
    }
    set bpm(value) {
        this.interval = 60000 * this.beatNum / value;
    }
    isEqual(other) {
        return this.interval === other.interval && this.beatNum === other.beatNum && this.beatUnit === other.beatUnit;
    }
}

// extended aMeasure
class eMeasure extends aMeasure {
    /**
     * 构造一个有位置信息的小节
     * @param {Number | eMeasure} id 小节号 或 eMeasure对象（复制构造）
     * @param {Number} start 小节开始时间 单位ms
     * @param {Number | aMeasure} beatNum 
     * @param {Number} beatUnit 
     * @param {Number} interval 
     */
    constructor(id = 0, start = 0, beatNum, beatUnit, interval) {
        if(typeof id === 'number') {
            super(beatNum, beatUnit, interval);
            this.id = id;       // 第几小节
            this.start = start; // 开始的时间 单位ms
        } else {
            super(id);
            this.id = id.id;
            this.start = id.start;
        }
    }
    /**
     * 基于某个小节构造一个新的小节
     * @param {eMeasure} base 同类型的小节
     * @param {Number} id 小节号
     * @param {aMeasure} measure 如果要修改值就传 否则参数同base
     * @returns 
     */
    static baseOn(base, id, measure = undefined) {
        return new eMeasure(id, (id - base.id) * base.interval + base.start, measure || base);
    }
}

class Beats extends Array {
    /**
     * 构造一个稀疏数组，只存储节奏变化
     * @param {Number} maxTime 乐曲时长 单位ms
     */
    constructor(maxTime = 60000) {
        super(1);
        this.maxTime = maxTime; // 用于迭代
        this[0] = new eMeasure(0, 0);
    }
    /**
     * 找到当前小节模式的小节头
     * @param {Number} at 当前小节的时间或小节号
     * @param {Boolean} timeMode at是否表示毫秒时间
     * @returns {Number} 小节头在实际数组中的位置
     */
    getBaseIndex(at, timeMode = false) {
        let attr = timeMode ? 'start' : 'id';
        for (let i = this.length - 1; i >= 0; i--) {
            if (this[i][attr] <= at) return i;
        } return -1;
    }
    /**
     * 迭代器屏蔽了数组的稀疏性 如要连续取值，在元素多的时候效果比getMeasure(id)好
     * 注意传入的参数需要自行匹配好，否则后果未知 建议用this.iterator()代替此函数
     * @param {Number} index 开始的序号
     * @param {Number} baseAt 基于的eMeasure对象在实际数组中的位置
     * @returns next()
     */
    [Symbol.iterator](index = 0, baseAt = 0) {
        return {
            next: () => {
                // 确定base
                let nextBase = this[baseAt + 1];
                if (nextBase && nextBase.id === index) baseAt++;
                else nextBase = this[baseAt];
                // 得到小节信息
                let value = eMeasure.baseOn(nextBase, index++);
                // 判断是否越界
                if (value.start >= this.maxTime) return { done: true };
                return {
                    value: value,
                    done: false
                };
            }
        };
    }
    /**
     * 从任意位置开始的迭代器
     * @param {Number} at 位置
     * @param {Boolean} timeMode at是否表示毫秒时间
     * @returns 迭代器
     */
    iterator(at, timeMode = false) {    // 由于在绘制更新中使用，故没有复用getBaseIndex以加速运行
        let attr = timeMode ? 'start' : 'id';
        for (let i = this.length - 1; i >= 0; i--) {
            if (this[i][attr] <= at) {
                let id = timeMode ? this[i].id + ((at - this[i].start) / this[i].interval) | 0 : at;
                return this[Symbol.iterator](id, i);
            }
        } return {
            next: () => ({ done: true })
        }
    }
    /**
     * 根据小节号返回一个只读的小节
     * @param {Number} at 小节号或覆盖该时刻的小节
     * @param {Boolean} timeMode 传入的是否是时间
     * @returns {eMeasure} 小节信息，修改返回值不会影响原数组 如果越界则返回null
     */
    getMeasure(at, timeMode = false) {
        let i = this.getBaseIndex(at, timeMode);
        if (i == -1) return null;
        let id = timeMode ? this[i].id + ((at - this[i].start) / this[i].interval) | 0 : at;
        let m = eMeasure.baseOn(this[i], id);
        if (m.start >= this.maxTime) return null;
        return m;
    }
    /**
     * 返回一个可以修改的对象。若修改返回值会影响原数组，修改后应调用this.check()
     * @param {Number} at 修改第几小节或覆盖该时间的小节
     * @param {aMeasure} measure 小节信息
     * @param {Boolean} timeMode at是否表示毫秒时间
     * @returns {eMeasure} 可以修改的对象 可以不传，通过修改返回值+check()来设置 如果越界则返回null
     */
    setMeasure(at, measure = undefined, timeMode = false) {
        let i = this.getBaseIndex(at, timeMode);
        if (i == -1) return null;
        // 检查id是否存在 如果不存在就找到第一个data.id > id的位置插入
        let id = timeMode ? this[i].id + ((at - this[i].start) / this[i].interval) | 0 : at;
        if (this[i].id == id) {
            if (measure) this[i].copy(measure);
            return this[i];
        }
        if (this[i].id < id) {
            // 不管是否重复 重复性的检查交给check
            let m = eMeasure.baseOn(this[i], id, measure);
            if (m.start >= this.maxTime) return null;
            this.splice(i + 1, 0, m); return m;
        }
    }

    /**
     * 整理小节信息:
     * 1. 合并前后参数一样的小节
     * 2. 校准每个小节的开始时间
     * 应该在添加、删除、修改数组元素后调用 需要手动调用
     */
    check() {
        this[0].start = 0;
        this[0].id = 0;
        for (let i = 0, end = this.length - 1; i < end; i++) {
            if (this[i].start > this.maxTime) {
                this.splice(i); return;
            }
            if (this[i].isEqual(this[i + 1])) {
                this.splice(i + 1, 1);
                i--; end--;
            } else this[i + 1].start = (this[i + 1].id - this[i].id) * this[i].interval + this[i].start;
        }
    }
    /**
     * 删除一个小节
     * @param {Number} at 位置
     * @param {Boolean} timeMode at是否表示毫秒时间
     */
    delete(at, timeMode = false) {
        let attr = timeMode ? 'start' : 'id';
        for (let i = this.length - 1; i >= 0; i--) {
            if (this[i][attr] <= at) {
                // 如果只有一个小节，则删除小节头
                if (this[i + 1] && this[i].id === this[i + 1].id) { // this[i+1].id不用减1，因为已经减过了
                    this.splice(i, 1);
                } break;
            } this[i].id--; // 后面的都前移一格
        } this.check();
    }
    /**
     * 增加一个小节，小节属性同前一个小节
     * @param {Number} at 位置
     * @param {Boolean} timeMode at是否表示毫秒时间
     */
    add(at, timeMode = false) {
        let attr = timeMode ? 'start' : 'id';
        for (let i = this.length - 1; i >= 0; i--) {
            if (this[i][attr] <= at) break;
            this[i].id++; // 后面的都后移一格
        } this.check();
    }
    /**
     * 拷贝数据 用户撤销恢复
     * @param {Beats} beatArray 
     * @returns {Beats} this
     */
    copy(beatArray) {
        this.length = beatArray.length;
        for (let i = beatArray.length - 1; i >= 0; i--) {
            this[i] = new eMeasure(beatArray[i]);
        } return this;
    }
}