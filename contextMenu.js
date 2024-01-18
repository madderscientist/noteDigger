class ContextMenu {
    /**
     * 创建菜单
     * @param {Array} items [{
     *   name: "菜单项",
     *   callback: (e_father, e_self) => {},   // 点击菜单项时调用的函数，传参是(触发右键菜单的事件,点击本项的事件)
     *   onshow: function (e) { // 在菜单项显示前调用，传参是触发右键菜单的事件
     *      // this指向菜单项对象，可以修改其属性
     *      return true/false;
     *   }  // 返回true/false控制本项是否显示
     * },...]
     */
    constructor(items = []) {
        this.items = items;
    }

    addItem(name, callback, onshow = null) {
        let existingItem = this.items.find(item => item.name === name);
        if (existingItem) existingItem.callback = callback;
        else this.items.push({ name: name, callback: callback, onshow: onshow });
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
        this.items.forEach(item => {
            if (item.onshow) if (!item.onshow(e)) return;
            const listItem = document.createElement('li');
            listItem.textContent = item.name;
            listItem.addEventListener('click', (e_self) => {
                item.callback(e, e_self);
                contextMenuCard.onblur = null;  // 如果没有这行，onblur会在contextMenuCard被item删除后再次触发删除，引发报错
                contextMenuCard.remove();
            });
            contextMenuCard.appendChild(listItem);
        });

        contextMenuCard.style.top = `${e.clientY}px`;
        contextMenuCard.style.left = `${e.clientX}px`;

        // 添加blur事件监听器
        contextMenuCard.tabIndex = -1; // 使元素可以接收焦点
        contextMenuCard.onblur = () => contextMenuCard.remove();

        document.body.appendChild(contextMenuCard);

        // 使元素立即获取焦点(要设置css:focue属性：outline:none;)
        contextMenuCard.focus();
    }
}
