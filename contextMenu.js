class ContextMenu {
    /**
     * 创建菜单
     * @param {Array} items [{
     *   name: "菜单项",
     *   callback: (e_father, e_self) => {  // 点击菜单项时调用的函数，传参是(触发右键菜单的事件,点击本项的事件)
     *      return false/true;
     *   }, // 返回false（或不返回）表示删除菜单，返回true表示不删除菜单
     *   onshow: function (e) { // 在菜单项显示前调用，传参是触发右键菜单的事件
     *      // this指向菜单项对象，可以修改其属性
     *      return true/false;
     *   }, // 返回true/false控制本项是否显示
     *   event: "click" // 确认触发本项的事件，默认是click
     * },...]
     * @param {boolean} mustShow 如果菜单项为空，是否显示
     */
    constructor(items = [], mustShow = false) {
        this.items = items;
        this.mustShow = mustShow;
    }

    addItem(name, callback, onshow = null, event = "click") {
        let existingItem = this.items.find(item => item.name === name);
        if (existingItem) existingItem.callback = callback;
        else this.items.push({ name: name, callback: callback, onshow: onshow, event: event });
    }
    removeItem(name) {
        for (let i = 0; i < this.items.length; i++) {
            if (this.items[i].name === name) {
                this.items.splice(i, 1);
                break;
            }
        }
    }

    show(e) {
        const contextMenuCard = document.createElement('ul');
        contextMenuCard.classList.add('contextMenuCard');
        contextMenuCard.oncontextmenu = () => false; // 禁用右键菜单
        this.items.forEach(item => {
            if (item.onshow) if (!item.onshow(e)) return;
            const listItem = document.createElement('li');
            listItem.innerHTML = item.name; // 从textContent改为innerHTML，可以使用html标签嵌套
            listItem.addEventListener(item.event || 'click', (e_self) => {
                if (!item.callback(e, e_self)) {
                    contextMenuCard.onblur = null;  // 如果没有这行，onblur会在contextMenuCard被item删除后再次触发删除，引发报错
                    contextMenuCard.remove();
                }
            });
            contextMenuCard.appendChild(listItem);
        });
        if (contextMenuCard.children.length === 0 && !this.mustShow) return;

        contextMenuCard.style.top = `${e.clientY}px`;
        contextMenuCard.style.left = `${e.clientX}px`;

        // 添加blur事件监听器
        contextMenuCard.tabIndex = -1; // 使元素可以接收焦点
        contextMenuCard.onblur = (e) => {
            // 如果在contextMenuCard内部点击，就不删除contextMenuCard
            if (e.relatedTarget && e.relatedTarget.classList.contains('contextMenuCard')) {
                e.stopPropagation();
                return;
            }
            contextMenuCard.remove();
        }
        setTimeout(() => {
            document.body.appendChild(contextMenuCard);
            // 使元素立即获取焦点(要设置css:focue属性：outline:none;)
            contextMenuCard.focus();
        }, 0);  // 延时是因为让show可以被mousedown事件调用（否则mousedown触发后再触发contextmenu将导致菜单消失）
    }
}
