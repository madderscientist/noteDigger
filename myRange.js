class myRange extends HTMLInputElement {
    /**
     * 设置原型并初始化
     * @param {HTMLInputElement} ele 
     * @returns {myRange}
     */
    static new(ele) {
        Object.setPrototypeOf(ele, myRange.prototype);
        myRange.prototype.init.call(ele);
        return ele;
    }
    /**
     * 设置一个容器
     * 执行了构造函数的内容
     */
    init() {
        this.default = super.value; // 默认值在html中设置
        this.container = document.createElement('div');
        this.container.classList.add('myrange');
        this.insertAdjacentElement('beforebegin', this.container);
        // 将当前元素插入到容器中
        this.container.appendChild(this);
        this.addEventListener('click', this.blur);  // 极速取消焦点 防止空格触发
    }
    set value(v) {
        super.value = v;
        this.dispatchEvent(new Event('input'));
    }
    get value() {
        return super.value;
    }
    reset() {
        this.value = this.default;
        return this;    // 可以链式调用，比如let r = myRange.new(document.querySelector('input')).reset();
    }
}

class LableRange extends myRange {
    static new(ele) {
        Object.setPrototypeOf(ele, LableRange.prototype);
        LableRange.prototype.init.call(ele);
        return ele;
    }
    /**
     * 添加一个容器、标签
     */
    init() {
        super.init();
        this.container.classList.add('labelrange');
        // 设置标签显示当前值
        this.label = document.createElement('span');
        this.label.className = "thelabel";
        this.insertAdjacentElement('afterend', this.label);
        // 设置label的宽度固定为range的最大值的宽度
        if (!this.max) this.max = 100;
        let maxStepStr = (this.max - this.step).toFixed(10).replace(/\.?0+$/, ''); // 限制小数位数并去除末尾的零
        let len = Math.max(this.max.toString().length, maxStepStr.length);
        this.label.style.width = `${len}ch`;
        this.addEventListener('input', () => {
            this.updateLabel(); // 【不直接传函数，可以篡改this.updateLabel】
        });
        // 标签的另一个作用：重置range的值
        this.label.addEventListener('click', this.reset.bind(this));
        // 【没有初始化label，需要用户手动调用reset()】
    }
    updateLabel() {
        this.label.textContent = super.value;
    }
}

class hideLableRange extends myRange {
    static _expand = 16;    // 和css有关 滑块的宽度
    static new(ele) {
        Object.setPrototypeOf(ele, hideLableRange.prototype);
        hideLableRange.prototype.init.call(ele);
        return ele;
    }
    /**
     * 添加一个容器、标签
     */
    init() {
        super.init();
        this.container.classList.add('hidelabelrange');
        // 设置标签显示当前值
        this.label = document.createElement('span');
        this.label.className = "thelabel";
        this.insertAdjacentElement('afterend', this.label);
        this.addEventListener('input', () => {
            this.updateLabel(); // 【不直接传函数，可以篡改this.updateLabel】
        });
        // 标签的另一个作用：重置range的值
        this.label.addEventListener('click', this.reset.bind(this));
        // 【没有初始化label，需要用户手动调用reset()】
        // 滑动时显示label
        this.label.style.display = 'none';
        this.addEventListener('focus', function () {
            this.label.style.display = 'block';
        });
        this.addEventListener('blur', function () {
            this.label.style.display = 'none';
        });
        this.addEventListener('input', this.labelPosition);
    }
    updateLabel() {
        this.label.textContent = super.value;
    }
    labelPosition() {
        let rangeRect = this.getBoundingClientRect();
        let rangeWidth = rangeRect.width - hideLableRange._expand;
        this.label.style.left = `${((this.value - this.min) / (this.max - this.min)) * rangeWidth + (hideLableRange._expand >> 1)}px`;
    }
}