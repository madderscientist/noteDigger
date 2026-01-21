// 基于快照的撤销重做数据结构
// 为了不改变数组大小减小开销，使用循环队列
class Snapshot extends Array {
    /**
     * 新建快照栈
     * @param {number} maxLen 快照历史数
     * @param {*} iniState 初始状态
     */
    constructor(maxLen, iniState = '') {
        super(maxLen);
        // 模型位置 从1开始计数
        this.now = 1;
        this.size = 1;
        this[0] = iniState;
        // 实际位置
        this.pointer = 0;
    }
    /**
     * 增加快照。在当前时间点上延展新的分支，并抛弃老的分支
     * @param {*} snapshot 快照 建议是JSON字符串
     */
    add(snapshot) {
        if (this.now < this.length) this.size = ++this.now; // 没满
        this.pointer = (this.pointer + 1) % this.length;    // 目标位置，直接覆盖
        this[this.pointer] = snapshot;
    }
    /**
     * 回到上一个快照状态，相当于撤销
     * @returns 上一刻的快照。如果无法回退则返回null
     */
    undo() {
        if (this.now <= 1) return null;
        this.now--;
        this.pointer = (this.pointer + this.length - 1) % this.length;
        return this[this.pointer];
    }
    /**
     * 重新回到下一个状态，相当于重做
     * @returns 下一刻的快照。如果下一状态则返回null
     */
    redo() {
        if (this.now >= this.size) return null;
        this.now++;
        this.pointer = (this.pointer + 1) % this.length;
        return this[this.pointer];
    }
    /**
     * 查看上一个快照状态，相当于撤销但不改变当前状态
     * @returns 上一个状态的快照。如果无法回退则返回null
     */
    lastState() {
        if (this.now <= 1) return null;
        return this[(this.pointer + this.length - 1) % this.length];
    }
    /**
     * 查看下一个快照状态，相当于重做但不改变当前状态
     * @returns 下一个状态的快照。如果下一状态则返回null
     */
    nextState() {
        if (this.now >= this.size) return null;
        return this[(this.pointer + 1) % this.length]; 
    }
    nowState() {
        return this[this.pointer];
    }
}