[合成器ADSR简单实现](https://www.jianshu.com/p/4f4c8bbd9775)
```js
class MusicBox {
  constructor(options){
    // 默认值
    let defaults = {
      type: 'sine',  // 音色类型  sine|square|triangle|sawtooth
      duration: 2  // 键音延长时间
    };

    this.opts = Object.assign(defaults, options);

    // 创建新的音频上下文接口
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  createSound(freq) {
    // 创建一个OscillatorNode, 它表示一个周期性波形（振荡），基本上来说创造了一个音调
    let oscillator = this.audioCtx.createOscillator();
    // 创建一个GainNode,它可以控制音频的总音量
    let gainNode = this.audioCtx.createGain();
    // 把音量，音调和终节点进行关联
    oscillator.connect(gainNode);
    // this.audioCtx.destination返回AudioDestinationNode对象，表示当前audio context中所有节点的最终节点，一般表示音频渲染设备
    gainNode.connect(this.audioCtx.destination);
    // 指定音调的类型  sine|square|triangle|sawtooth
    oscillator.type = this.opts.type;
    // 设置当前播放声音的频率，也就是最终播放声音的调调
    oscillator.frequency.value = freq;
    // 当前时间设置音量为0
    gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
    // 0.01秒后音量为1
    gainNode.gain.linearRampToValueAtTime(1, this.audioCtx.currentTime + 0.01);
    // 音调从当前时间开始播放
    oscillator.start(this.audioCtx.currentTime);
    // this.opts.duration秒内声音慢慢降低，是个不错的停止声音的方法
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + this.opts.duration);
    // this.opts.duration秒后完全停止声音
    oscillator.stop(this.audioCtx.currentTime + this.opts.duration);
  }
}
```

音色合成，原理是多个振荡器连接到一个节点，同时启动/停止。[](https://webdesign.tutsplus.com/the-web-audio-api-make-your-own-web-synthesizer--cms-23887t)