class SiderContent extends HTMLDivElement {
    static new(ele, minWidth) {
        Object.setPrototypeOf(ele, SiderContent.prototype);
        SiderContent.prototype.init.call(ele, minWidth);
        return ele;
    }
    init(minWidth) {
        this.resize = this._resize.bind(this);
        this.mouseup = this._mouseup.bind(this);
        this.mousedown = this._mousedown.bind(this);

        this.classList.add('siderContent');
        this.minWidth = minWidth;
        this.judge = (minWidth >> 1) + this.getBoundingClientRect().left;
        this.style.width = minWidth + 'px';

        const bar = document.createElement('div');
        bar.className = 'siderBar';
        this.insertAdjacentElement('afterend', bar);
        bar.addEventListener('mousedown', this.mousedown);
        this.bar = bar;
    }
    _mousedown(e) {
        if (e.button) return;
        document.addEventListener('mousemove', this.resize);
        document.addEventListener('mouseup', this.mouseup);
    }
    _resize(e) {
        if (e.clientX < this.judge) this.display = 'none';
        else {
            let rect = this.getBoundingClientRect();
            let w = e.clientX - rect.left;
            if (w < this.minWidth) return;
            // 触发刷新
            this.width = w + 'px';
            this.display = 'block';
        }
    }
    _mouseup() {
        document.removeEventListener('mousemove', this.resize);
        document.removeEventListener('mouseup', this.mouseup);
        this.bar.blur();
        window.dispatchEvent(new Event("resize"));  // 触发app.resize
    }
    get display() {
        return this.style.display;
    }
    // 设置display可以触发刷新 因为app.resize绑定在window.onresize上
    set display(state) {
        if (this.style.display != state) {
            this.style.display = state;
            window.dispatchEvent(new Event("resize"));
        }
    }
    get width() {
        return this.style.width;
    }
    set width(w) {
        if (this.style.width != w) {
            this.style.width = w;
            window.dispatchEvent(new Event("resize"));
        }
    }
}

class SiderMenu extends HTMLDivElement {
    /**
     * 构造tabMenu和container
     * @param {HTMLDivElement} menu 存放tab的 样式: .siderTabs 每一个tab: .siderTab
     * @param {HTMLDivElement} container 展示具体内容的 样式: .siderContent 拖动条: .siderBar 每一个子内容都会加上siderItem类
     * @param {number} minWidth 展示具体内容的最小宽度
     * @returns 
     */
    static new(menu, container, minWidth) {
        Object.setPrototypeOf(menu, SiderMenu.prototype);
        SiderMenu.prototype.init.call(menu, container, minWidth);
        return menu;
    }
    init(box, minWidth) {
        this.classList.add('siderTabs');
        this.container = SiderContent.new(box, minWidth);
        box.display = 'none';
        this.tabClick = this._tabClick.bind(this);
        this.tabs = [];
    }
    /**
     * 添加一个菜单项及其内容
     * @param {string} name tab的名字
     * @param {string} tabClass tab的类名 用空格分隔
     * @param {HTMLElement} dom tab对应的内容
     * @param {boolean} selected 是否默认选中
     * @returns {HTMLDivElement} 添加的tab
     */
    add(name, tabClass, dom, selected = false) {
        const tab = document.createElement('div');
        tab.className = 'siderTab';
        tab.classList.add(...tabClass.split(' '));
        tab.dataset.name = name;

        this.container.appendChild(dom);
        dom.classList.add('siderItem');
        dom.style.display = 'none';
        tab.item = dom;

        tab.addEventListener('click', this.tabClick);
        this.appendChild(tab);
        if (this.tabs.push(tab) == 1) {
            tab.classList.add('selected');
            dom.style.display = 'block';
        } else if (selected) this.select(tab);
        return tab;
    }
    /**
     * 选中一个标签
     * @param {HTMLDivElement || Number} tab 
     * @returns {HTMLDivElement} 选择的标签
     */
    select(tab) {
        if (typeof tab == 'number') tab = this.tabs[tab];
        if (!tab) return;
        for (const t of this.tabs) {
            t.classList.remove('selected');
            t.item.style.display = 'none';
        }
        tab.classList.add('selected');
        tab.item.style.display = 'block';
        return tab;
    }
    /**
     * 控制面板的显示
     * @param {boolean} ifshow 是否显示面板
     */
    show(ifshow = true) {
        this.container.display = ifshow ? 'block' : 'none';
    }
    // 绑定给tab用，不应该用户被调用
    _tabClick(e) {
        const tab = e.target;
        if (tab.classList.contains('selected')) {    // 如果显示的就是tab的，则隐藏
            // 用style.dispaly是读取，用.display = 是为了刷新
            this.container.display = this.container.style.display == 'none' ? 'block' : 'none';
        } else {    // 否则只显示tab的
            for (const t of this.tabs) {
                t.classList.remove('selected');
                t.item.style.display = 'none';
            }
            tab.classList.add('selected');
            this.container.display = 'block';
        }
        tab.item.style.display = 'block';
        tab.blur();
    }
}