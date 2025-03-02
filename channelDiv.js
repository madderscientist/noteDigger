/**
 * 可拖动列表
 * @param {*} takeplace 占位符是否起作用，用于拖拽到最后还留有一段空间
 * @returns {HTMLDivElement} 一个可以拖动元素的ul
 */
function dragList(takeplace = true) {
    let list = document.createElement('ul');
    list.classList.add('drag_list');

    // 为了编写方便，占位符一直存在
    list.innerHTML = `<div ${takeplace ? "class='takeplace'" : "style='display:none;'"}></div>`;
    // 由于占位的存在，所以不能用原来的children获取li。对外屏蔽这个占位
    Object.defineProperty(list, 'children', {
        get: function () {  // querySelectorAll 方法返回的是一个 NodeList 对象，而不是一个真正的数组
            return Array.from(this.querySelectorAll('li'));
        }
    });

    let dragging = null;
    list.ondragstart = (e) => {
        dragging = e.target;
        setTimeout(() => {  // 为了让拖拽的dom还保持原有样式，所以延迟添加moving样式
            e.target.classList.add('moving');
        }, 0);
        e.dataTransfer.effectAllowed = 'move';
    };
    // 以下两个事件使用addEventListener，用于后续添加新的事件
    list.addEventListener('dragover', (e) => {
        e.preventDefault();
        let target = e.target;
        // 防止因为拖拽到li的子元素而判断为不是拖拽到li
        while (target.nodeName !== 'LI') {
            target = target.parentNode;
            if (!target) return;
        }
        if (target != dragging) {
            const rect = target.getBoundingClientRect()
            let rectHalfPosition = rect.y + (rect.height >> 1);    // 计算目标的中间在屏幕中的坐标
            if (e.clientY > rectHalfPosition) { // 在目标元素下方插入
                list.insertBefore(dragging, target.nextElementSibling);    // 从下向上拖动
            } else {    // 在目标元素上方插入
                list.insertBefore(dragging, target);
            }
        }
    });
    list.addEventListener('dragend', (e) => {
        e.target.classList.remove('moving');
    });
    // 添加元素将用li包裹
    list.appendChild = function (node, at = -1) {
        let ITEM = document.createElement('li');
        ITEM.draggable = true;
        ITEM.classList.add('drag_list-item');
        ITEM.appendChild(node);
        if (at < 0) {
            this.insertBefore(ITEM, this.lastElementChild);
        } else {    // 只关注li
            const liElements = this.querySelectorAll('li');
            if (at >= 0 && at < liElements.length) {
                this.insertBefore(ITEM, liElements[at]);
            } else {
                this.insertBefore(ITEM, this.lastElementChild);
            }
        }
    };
    list.clear = function () {
        const takeplace = this.lastElementChild;
        this.innerHTML = '';
        Node.prototype.appendChild.call(this, takeplace);
    }
    // 动画的原理是，先用translate变到之前的位置，然后通过设置translate=none变回来。但是涉及动画时反复触发的问题，所以没做
    // transtition的时候获取的坐标是最终值，所以也不能中途转向
    return list;
}

// 为了可读性、隔离性、模块化，使用此类包裹HTMLDivElement
// 此类设计为
class ChannelItem extends HTMLDivElement {
    /**
     * 实际并不使用构造函数 此函数只是表明有哪些属性可用
     */
    constructor() {
        super();
        this.nameDiv = null;
        this.instrumentDiv = null;
        this.visibleButton = null;
        this.muteButton = null;
    }
    /**
     * 通过更改原型链实现构造
     * @param {String} name 
     * @param {String} color 
     * @returns {ChannelItem}
     */
    static new(name = "channel", color = "red", instrument = "Piano", visible = true, mute = false) {
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = `
        <div class="channel-Container" style="--tab-color: ${color};" data-tab-index="1">
            <div class="upper">
                <div class="channel-Name">${name}</div>
                <div>
                    <button class="tab iconfont icon-eye-fill" data-state="visible"></button>
                    <button class="tab iconfont icon-volume" data-state="nomute"></button>
                </div>
            </div> <div class="channel-Instrument">${instrument}</div>
        </div>`;    // 可以通过设置style的--tab-color改颜色；data-tab-index用于显示序号
        let container = tempDiv.firstElementChild;  // 不能用firstChild因为获取的是文本节点
        container.nameDiv = tempDiv.querySelector('.channel-Name');
        container.instrumentDiv = tempDiv.querySelector('.channel-Instrument');
        const buttons = tempDiv.querySelectorAll('.tab');
        container.visibleButton = buttons[0];
        container.muteButton = buttons[1];
        buttons[0].addEventListener('click', (e) => {
            e.stopPropagation();
            container.visible = !container.visible;
        });
        buttons[1].addEventListener('click', (e) => {
            e.stopPropagation();
            container.mute = !container.mute;
        });
        // 设置原型链为ChannelItem
        Object.setPrototypeOf(container, ChannelItem.prototype);
        container.visible = visible;
        container.mute = mute;
        return container;
    }
    get name() {
        return this.nameDiv.innerHTML;
    }
    set name(channelName) {
        this.nameDiv.innerHTML = channelName;
    }
    get instrument() {
        return this.instrumentDiv.innerHTML;
    }
    set instrument(instrument) {
        this.instrumentDiv.innerHTML = instrument;
    }
    get color() {
        return this.style.getPropertyValue('--tab-color');
    }
    set color(color) {
        this.style.setProperty('--tab-color', color);
    }
    get visible() { // true为可见
        return this.visibleButton.dataset.state === 'visible';
    }
    set visible(visible) {
        if (typeof visible !== 'boolean') visible = visible === "visible";
        if (visible) {
            this.visibleButton.dataset.state = 'visible';
            this.visibleButton.classList.remove('icon-eyeslash-fill');
            this.visibleButton.classList.add('icon-eye-fill');
        } else {
            this.visibleButton.dataset.state = 'invisible';
            this.visibleButton.classList.remove('icon-eye-fill');
            this.visibleButton.classList.add('icon-eyeslash-fill');
        }
    }
    get mute() { // true为静音
        return this.muteButton.dataset.state === 'mute';
    }
    set mute(mute) {
        if (typeof mute !== 'boolean') mute = mute === "mute";
        if (mute) {
            this.muteButton.dataset.state = 'mute';
            this.muteButton.classList.remove('icon-volume');
            this.muteButton.classList.add('icon-close_volume');
        } else {
            this.muteButton.dataset.state = 'nomute';
            this.muteButton.classList.remove('icon-close_volume');
            this.muteButton.classList.add('icon-volume');
        }
    }
    /**
     * 从0开始，表示第几项；但显示时从1开始。需要外部维护
     */
    get index() {
        return parseInt(this.dataset.tabIndex) - 1;
    }
    set index(index) {
        this.dataset.tabIndex = index + 1;
    }
    toJSON() {  // 用于序列化，以实现撤销
        return {
            name: this.name,
            color: this.color,
            instrument: this.instrument,
            visible: this.visible,
            mute: this.mute
        };
    }
}

/**
 * 依赖：contextMenu dragList ChannelItem tinySynth
 * 事件：（按发生的顺序排）
 * remove(detail)：发生于删除之前、归还颜色之后
 * reorder(detail)：发生于有序号变化时，最后一个ChannelItem的删除和新增不会触发
 */
class ChannelList extends EventTarget {
    // 颜色是对通道的特异性标识
    static colorList = [
        "#FF4500", /*橙红色*/ "#FFD700", /*金色*/ "#32CD32", /*酸橙绿*/ "#00BFFF", /*深天蓝色*/
        "#FF6347", /*番茄色*/ "#FF1493", /*深粉红色*/ "#7FFF00", /*查特酸橙绿*/ "#1E90FF", /*道奇蓝*/
        "#FFA500", /*橙色*/ "#EE82EE", /*紫罗兰*/ "#ADFF2F", /*绿黄色*/ "#87CEFA", /*亮天蓝色*/
        "#FF69B4", /*热情粉红色*/ "#00FA9A", /*中春绿色*/ "#FFB6C1", /*浅粉红色*/ "#20B2AA"  /*浅海洋绿*/
    ];
    /**
     * 判断是否点击在channelItem上
     * 必须被<li>包裹才能生效 因此耦合了dragList和dom结构
     * @param {HTMLElement} target 一般是e.target
     * @returns 如果点击在channelItem上，返回channelItem的container，否则返回null
     */
    static whichItem(target) {
        const li = target.tagName === 'LI' ? target : target.closest('li');
        if (li && li.firstElementChild.classList.contains('channel-Container')) {
            return li.firstElementChild;
        } else return null;
    }
    static judgeClick(e) { return ChannelList.whichItem(e.target); }
    /**
     * 初始画可拖拽音轨列表
     * @param {HTMLDivElement} div 
     * @param {TinySynth} synthesizer 合成器实例
     */
    constructor(div, synthesizer) {
        super();
        this.synthesizer = synthesizer;
        this.colorMask = 0xFFFF;    // 用于表示哪些颜色已经被占用
        const list = dragList();
        list.addEventListener('dragend', this.updateRange.bind(this));
        this.selected = null;
        list.addEventListener('click', e => { this.selectChannel(e.target); });
        this.container = list;
        this.channel = [];  // 由updateRange维护 作用是根据id快速定位ChannelItem 屏蔽了li的包裹
        this.addChannel();  // 默认有一个
        div.appendChild(list);
        // 右键菜单
        this.contextMenu = new ContextMenu([
            // 在空白部分右击
            {
                name: '添加音轨', callback: () => {
                    this.addChannel();
                }, onshow: e => !ChannelList.whichItem(e.target) && this.colorMask
            }, {
                name: '全部隐藏', callback: () => {
                    this.channel.forEach(ch => ch.visible = false);
                }, onshow: e => !ChannelList.whichItem(e.target),
            }, {
                name: '全部显示', callback: () => {
                    this.channel.forEach(ch => ch.visible = true);
                }, onshow: e => !ChannelList.whichItem(e.target),
            },
            // 在列表项上点击
            {
                name: '属性设置', callback: (e) => {
                    let id = parseInt(ChannelList.whichItem(e.target).dataset.tabIndex) - 1;
                    this.selectChannel(id); // 传id计算量小一点
                    this.settingPannel(id);
                }, onshow: ChannelList.judgeClick
            }, {
                name: '在上方插入音轨', callback: (e) => {
                    let id = parseInt(ChannelList.whichItem(e.target).dataset.tabIndex) - 1;
                    this.addChannel(id);
                }, onshow: ChannelList.judgeClick
            }, {
                name: '在下方插入音轨', callback: (e) => {
                    let id = parseInt(ChannelList.whichItem(e.target).dataset.tabIndex);
                    this.addChannel(id);
                }, onshow: ChannelList.judgeClick
            }, {
                name: '<span style="color: red;">删除该轨</span>', callback: (e) => {
                    this.removeChannel(ChannelList.whichItem(e.target));
                }, onshow: ChannelList.judgeClick
            }
        ]);
        list.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.contextMenu.show(e);
        });
        ChannelItem.prototype.toJSON = this._toJSON;
    }
    /**
     * 根据ui维护this.channel和channelItem.dataset.tabIndex
     * 如果发生变化会触发事件：reorder，detail为老顺序->新顺序的变换关系，类似状态转移矩阵
     * “新增在最后一个”和“删除最后一个”不会触发reorder
     */
    updateRange() {
        let change = false;
        let children = Array.from(this.container.children);
        let indexMap = new Array(children.length + 1);  // 防止重新分配空间 加一是为了兼容删除一个后的reorder
        this.synthesizer.channel = new Array(children.length);
        this.channel = new Array(children.length);
        for (let i = 0; i < children.length; i++) {
            const channel = children[i].firstElementChild;
            let oldIndex = channel.index;
            indexMap[oldIndex] = i;     // 如果在at插入了新的ChannelItem，由于其序号已经对应好，所以不会触发change；且原来在at的元素被推到了(at+1)，会覆盖其对indexMap[at]的更改
            if (oldIndex !== i) change = true;
            channel.dataset.tabIndex = i + 1;
            this.channel[i] = channel;
            this.synthesizer.channel[i] = channel.ch;
        }
        if (change) this.dispatchEvent(new CustomEvent("reorder", {
            detail: indexMap
        }));
    }

    /* 颜色管理 begin */
    borrowColor() {
        for (let i = 0; i < ChannelList.colorList.length; i++) {
            if (this.colorMask & (1 << i)) {
                this.colorMask ^= (1 << i);
                return ChannelList.colorList[i];
            }
        } return null;
    }
    borrowTheColor(color) {
        for (let i = 0; i < ChannelList.colorList.length; i++) {
            if (ChannelList.colorList[i] === color) {
                if (this.colorMask & (1 << i)) {
                    this.colorMask ^= (1 << i);
                    return color;
                } else return null;
            }
        } return null;
    }
    returnColor(color) {
        for (let i = 0; i < ChannelList.colorList.length; i++) {
            if (ChannelList.colorList[i] === color) {
                this.colorMask |= (1 << i);
                return;
            }
        }
    }
    /* 颜色管理 end */
    /**
     * 增加一个channel，触发add事件，发生于插入之后
     * 然后可能会触发reorder事件，取决于是否插入最后一个
     * 最后触发added事件
     * @param {Number} at 插入音轨的序号
     * @returns {ChannelItem}
     */
    addChannel(at = this.channel.length) {    // 用于一个个添加
        if (!this.colorMask) {
            alert(`最多只能添加${ChannelList.colorList.length}个轨道！`);
            return;
        }
        const ch = ChannelItem.new('某音轨', this.borrowColor(), TinySynth.instrument[0]);
        ch.index = at;
        ch.ch = this.synthesizer.addChannel(at);
        this.container.appendChild(ch, at);
        ch.click();
        this.dispatchEvent(new CustomEvent("add", {
            detail: ch
        }));
        this.updateRange();
        this.dispatchEvent(new Event("added"));
        return ch;
    }
    /**
     * 删除一个channel，触发remove事件，发生于删除之前、归还颜色之后
     * 然后可能会触发reorder事件，取决于是否删除最后一个
     * 最后触发removed事件
     * remove事件必须在reorder之前，因为reorder会触发重新映射，之后就不能根据原有的索引删除音符了
     * 此外由于reorder的不稳定触发（会触发存档操作），使用时需要提前清除reorder的回调
     * @param {ChannelItem || Number} node 节点的序号或者节点或其子元素
     */
    removeChannel(node) {
        const channel = typeof node === 'number' ? this.channel[node] : ChannelList.whichItem(node);
        if (!channel) return;
        this.returnColor(channel.color);
        this.dispatchEvent(new CustomEvent("remove", {
            detail: channel
        }));
        this.synthesizer.channel.splice(channel.index, 1);
        if (this.selected === channel) this.selected = null;
        // 之所以要parentNode是因为dragList中添加项会用<li>包裹
        // 而this.channel[node]是channelItem（在上一次的updateRange中根据container.children赋值，赋值时使用了firstElementChild）
        channel.parentNode.remove();
        this.updateRange()  // 可能会触发reorder事件
        this.dispatchEvent(new Event("removed"));
    }
    /**
     * 设置选中的channel的样式
     * @param {ChannelItem || Number} node 节点的序号或者节点或其子元素
     * @returns {ChannelItem} 如果无该项则返回null
     */
    selectChannel(node) {
        const channel = typeof node === 'number' ? this.channel[node] : ChannelList.whichItem(node);
        if (channel && channel !== this.selected) {
            if (this.selected) this.selected.classList.remove('selected');
            this.selected = channel;
            channel.classList.add('selected');
            return channel;
        } return null;
    }
    /**
     * 打开ch的设置面板
     * @param {Number} chid 音轨序号
     */
    settingPannel(chid) {
        const ch = this.channel[chid];
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = `
        <div class="request-cover">
            <div class="card hvCenter"><label class="title">音轨${ch.dataset.tabIndex}设置</label>
                <div class="layout"><span>音轨名:</span><input type="text" name="ui-ask"></div>
                <div class="layout"><span>音量：&nbsp;</span><input type="number" name="ui-ask" value="100" step="1" min="0" max="127"></div>
                <div class="layout"><span>音色：&nbsp;</span><select name="ui-ask"></select></div>
                <div class="layout"><button class="ui-cancel">取消</button><button class="ui-confirm">确定</button></div>
            </div>
        </div>`;
        const card = tempDiv.firstElementChild;
        const btns = card.getElementsByTagName('button');
        card.addEventListener('keydown', (e) => {
            if (e.keyCode === 13) btns[1].click();  // 回车则点击btns[1]
        });
        const close = () => {   // 渐变消失
            card.style.opacity = 0;
            setTimeout(()=>card.remove(), 200);
        }
        btns[0].addEventListener('click', close);
        btns[1].addEventListener('click', () => {
            ch.name = inputs[0].value;
            ch.ch.volume = parseInt(inputs[1].value);
            let inst = parseInt(inputs[2].value);
            ch.ch.instrument = inst;
            ch.instrument = TinySynth.instrument[inst];
            close();
        });
        const inputs = card.querySelectorAll('[name="ui-ask"]');
        inputs[0].value = ch.name;
        inputs[1].value = ch.ch.volume;
        // 给select添加选项
        for (let i = 0; i < 128; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.innerHTML = TinySynth.instrument[i];
            if (ch.ch.instrument === i) option.selected = true;
            inputs[2].appendChild(option);
        }
        document.body.insertBefore(card, document.body.firstChild);
        card.tabIndex = 0;
        card.focus();
    }
    _toJSON() {
        return {    // 篡改ChannelItem的原型方法，使保存的乐器是序号，并能保存音量
            name: this.name,
            color: this.color,
            visible: this.visible,
            mute: this.mute,
            instrument: this.ch.instrument,
            volume: Math.round(Math.sqrt(this.ch.out.gain.value * 16129)),
            selected: this.classList.contains('selected') ? 1 : undefined
        };
    }
    /**
     * 从数组中创建列表，用于撤销 不会(不能)调用updateRange
     * @param {Array} array 
     */
    fromArray(array) {
        let len = array.length;
        if (len > ChannelList.colorList.length) {
            console.warn(`轨道数超过最大值${ChannelList.colorList.length}！将忽略多余的轨道。`);
            len = ChannelList.colorList.length;
        }
        this.synthesizer.channel.length = 0;
        this.container.clear();
        this.channel = new Array(len);
        this.colorMask = 0xFFFF;
        let failed = 0x0000;
        for (let i = 0; i < len; i++) {
            const item = array[i];
            let color = this.borrowTheColor(item.color);
            if (!color) {
                color = '';
                failed &= (1 << i);
            }
            const ch = ChannelItem.new(item.name, color, TinySynth.instrument[item.instrument], item.visible, item.mute);
            ch.ch = this.synthesizer.addChannel(i, item.instrument, item.volume * item.volume / 16129);
            this.channel[i] = ch;
            ch.dataset.tabIndex = i + 1;
            if (item.selected) ch.click();
            this.container.appendChild(ch);
        }
        if (failed) {
            console.warn('颜色冲突或超出范围！将自动分配违规颜色。');
            for (let i = 0; i < len; i++) {
                if (failed & (1 << i)) {
                    this.channel[i].color = this.borrowColor();
                }
            }
        }
    }
}