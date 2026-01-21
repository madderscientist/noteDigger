/* 示例
function save() {
    let B = bSaver.Float32Mat2Buffer(b);
    let A = bSaver.Object2Buffer(a);
    bSaver.saveArrayBuffer(bSaver.combineArrayBuffers(
        [B, A]
    ), "test.nd");
}
var result;
function parse() {
    let input = document.createElement("input");
    input.type = "file";
    input.onchange = function() {
        let file = input.files[0];
        bSaver.readBinary(file, (arrayBuffer)=>{
            let [B, o] = bSaver.Buffer2Float32Mat(arrayBuffer, 0);
            let [A, o2] = bSaver.Buffer2Object(arrayBuffer, o);
            result = [A,B];
            console.log(result);
        })
    } input.click();
}
*/
// 保存和读取二进制数据的工具
// 每个数据段开头会有Uint32(可能多个)的长度信息, 用于保存该数据段的长度
window.bSaver = {
    /**
     * 将二维的Float32Array的Array转为可解析的一维ArrayBuffer
     * 要求每个Float32Array的长度相同
     * @param {Array<Float32Array>} Float32Mat 
     * @returns {ArrayBuffer} 二进制数组 开头有两个Uint32的长度信息, 用于保存每个Float32Array的长度和Float32Mat的长度
     */
    Float32Mat2Buffer(Float32Mat) {
        // 先保存两个维度的长度: 每个Float32Array的长度和Float32Mat的长度
        const lengthArray = new Uint32Array([Float32Mat[0].length, Float32Mat.length]);
        let offset = lengthArray.byteLength;
        let bn = Float32Mat[0].byteLength;
        const finalArrayBuffer = new ArrayBuffer(offset + bn * Float32Mat.length);
        new Uint32Array(finalArrayBuffer, 0, 2).set(lengthArray);
        // 再将每个Float32Array的数据拷贝到finalArrayBuffer中
        for (const floatArray of Float32Mat) {
            new Float32Array(finalArrayBuffer, offset).set(floatArray);
            offset += bn;
        } return finalArrayBuffer;
    },
    /**
     * 解析Float32Mat2Buffer得到的二进制数组为二维的Float32Array的Array
     * @param {ArrayBuffer} arrayBuffer 待解析的二进制数组
     * @param {number} offset 读取的byte偏移量
     * @returns {[Array<Float32Array>, Number]} 解析后的二维Float32Array数组和读取结束后的byte偏移量
     */
    Buffer2Float32Mat(arrayBuffer, offset = 0) {
        offset = Math.ceil(offset / 4) << 2;    // offset变为4的倍数
        let lengthArray = new Uint32Array(arrayBuffer, offset, 2);
        offset += lengthArray.byteLength;
        let [n, N] = lengthArray;
        const mergedFloatArray = new Float32Array(arrayBuffer, offset, n * N);
        const Float32Mat = new Array(N);
        for (let i = 0, j = 0; i < N; i++, j += n) {
            Float32Mat[i] = mergedFloatArray.subarray(j, j + n);
        } return [Float32Mat, offset + mergedFloatArray.byteLength];
    },
    /**
     * 将字符串转为可解析的二进制数组
     * @param {string} str 字符串
     * @returns {ArrayBuffer} 二进制数组 开头有一个Uint32的长度信息记录BinaryData的长度
     */
    String2Buffer(str) {
        const jsonBinaryData = new TextEncoder().encode(str);
        // 用一个Uint32Array保存jsonBinaryData的长度
        const lengthArray = new Uint32Array([jsonBinaryData.byteLength]);
        const finalArrayBuffer = new ArrayBuffer(lengthArray.byteLength + jsonBinaryData.byteLength);
        new Uint32Array(finalArrayBuffer, 0, 1).set(lengthArray);
        new Uint8Array(finalArrayBuffer, lengthArray.byteLength).set(new Uint8Array(jsonBinaryData));
        return finalArrayBuffer;
    },
    /**
     * 解析String2Buffer得到的二进制数组为字符串
     * @param {ArrayBuffer} arrayBuffer 待解析的二进制数组
     * @param {number} offset 读取的byte偏移量
     * @returns {[String, Number]} 解析后的对象和读取结束后的byte偏移量
     */
    Buffer2String(arrayBuffer, offset = 0) {
        offset = Math.ceil(offset / 4) << 2;    // offset变为4的倍数
        const lengthArray = new Uint32Array(arrayBuffer, offset, 1);
        offset += lengthArray.byteLength;
        const strBinaryData = new Uint8Array(arrayBuffer, offset, lengthArray[0]);
        const str = new TextDecoder().decode(strBinaryData);
        return [str, offset + strBinaryData.byteLength];
    },
    /**
     * 将一个可以被JSON.stringify的对象转为可解析的二进制数组
     * @param {Object} obj 可以被JSON.stringify的对象
     * @returns {ArrayBuffer} 二进制数组 开头有一个Uint32的长度信息记录jsonBinaryData的长度
     */
    Object2Buffer(obj) {
        return this.String2Buffer(JSON.stringify(obj));
    },
    /**
     * 解析Object2Buffer得到的二进制数组为一个可以被JSON.stringify的对象
     * @param {ArrayBuffer} arrayBuffer 待解析的二进制数组
     * @param {number} offset 读取的byte偏移量
     * @returns {[Object, Number]} 解析后的对象和读取结束后的byte偏移量
     */
    Buffer2Object(arrayBuffer, offset = 0) {
        let [jsonString, o] = this.Buffer2String(arrayBuffer, offset);
        return [JSON.parse(jsonString), o];
    },
    /**
     * 合并多个ArrayBuffer为一个ArrayBuffer
     * 会按4byte对齐每一个ArrayBuffer的起始位置
     * @param {Array<ArrayBuffer>} arrayBuffers ArrayBuffer的数组
     * @returns {ArrayBuffer} 合并后的ArrayBuffer
     */
    combineArrayBuffers(arrayBuffers) {
        let totalByteLength = 0;
        const lengthArray = arrayBuffers.map((arrayBuffer) => {
            // 用4字节对齐，因为开头是Uint32的长度信息: start offset of Uint32Array should be a multiple of 4
            let len4 = Math.ceil(arrayBuffer.byteLength / 4) << 2;
            totalByteLength += len4;
            return len4;
        });
        const combinedArrayBuffer = new ArrayBuffer(totalByteLength);
        for(let i = 0, offset = 0; i < arrayBuffers.length; i++) {
            new Uint8Array(combinedArrayBuffer, offset).set(new Uint8Array(arrayBuffers[i]));
            offset += lengthArray[i];
        } return combinedArrayBuffer;
    },
    /**
     * 将二进制数组保存为文件
     * @param {ArrayBuffer} arrayBuffer 待保存的二进制数组
     * @param {string} filename 保存的文件名
     */
    saveArrayBuffer(arrayBuffer, filename) {
        // 创建一个 Blob 对象，将合并后的 ArrayBuffer 保存为二进制文件
        const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
        // 创建一个临时 URL，用于下载文件
        const downloadUrl = URL.createObjectURL(blob);
        // 创建一个虚拟的下载链接并触发点击事件
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = filename;
        downloadLink.click();
        // 释放临时 URL 对象
        URL.revokeObjectURL(downloadUrl);
    },
    // 读取文件为ArrayBuffer
    readBinary(file, callback) {
        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            callback(e.target.result);
        }; fileReader.readAsArrayBuffer(file);
    }
};