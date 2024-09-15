# 在线扒谱应用设计
1. 获取时域数据（Web Audio API 解码上传的音频文件）【done】
2. 获取频域信息（FFT类）【done】
采样率设置为44100，取8192点的实数FFT，分析范围：C1-B7，但点数限制只能区分F#2以上的音符。
3. 特征提取：提取84个音符的幅度。
粗糙地实现了。思路是只在需要的频率附近查找。
面临三个问题：
3.1. 频谱泄露如何处理
3.2. 最高到22050Hz，但是音符最高3950Hz，取到C8，即只需777点。后面的是否保留？
3.3. 有的音乐中心频率不是正好440Hz，是否需要自适应？和频谱泄露处理有关。
——目前的解决方案：在相邻音周围求平方和。因为有频谱泄露，所以需要收集泄露的频谱的能量。而频谱泄露是对称的，所以相邻音中间的频谱对半分。自适应不实现，因为上述解决方案对音不准有一定的适应能力（音乐高适应性越强，但低音容易出现误判）。每次处理以音符为单位，只搜索周围的能量，所以后面的没用到，随垃圾回收而释放。
4. 画图。交互
todo。面临问题：
4.1. 实时刷新还是一次画完？——选择实时刷新，用无限画布的思路
4.2. 幅度达到多少认为完全可信？——手调吧。设置一个参数。
功能：是否自动跟随？
5. 播放音乐和midi
todo。问题很多，主要是前端的midi播放。在后文列举。

## 边角功能：
文件拖拽上传。done
自动识别音符？比如利用频谱后面的内容，分辨出谐波

## 画图要点
无限画布 https://blog.csdn.net/shulianghan/article/details/120863626

## 键盘画图
C1对应24 全部按照midi协议编号。
以一个八度作为最小绘制单元，目前实现的绘图有所冗余，性能未达最优，但是懒得改了。

## midi可视化创建
关键是如何响应鼠标操作！用状态代替动作
描述一个midi音符：音高，起始，终止，是否选中

效果描述：
鼠标按下：
- 如果按在空白则新建音符，进入调整时长模式
- 如果按在音符上：
    ctrl是否按下？
    - 按下：选择多个
    - 没按下：是否已经选择了多个？
        - 是：鼠标抬起的时候，如果之前有拖动则什么也不做，否则仅选中当前那个
        - 否：仅选一个
        判断点击位置：
        - 前一半：后面的是拖动模式
        - 后一半：后面的是调整时长模式
        无论是那种模式，都支持音高上的调整

如何添加音符？
1. 点击的时候确认位置，已经添加进去了。
2. 设置这个音符为选中，模式是调整时长。

选中有两个方案：
1. 设置一个选中列表，存选中的midi音符对象的地址
有一个难点：绘制的时候如何让选中的不绘制两次？
2. 每个音符设置一个选中状态
有一个难点：每次调整音符状态的时候，都需要遍历所有音符

结论是：两者结合，空间换时间。

播放如何同步？

## 多音轨
此功能似乎用得不多。
wavetone中，每个音轨之间不存在明显的界限，而signal中，只有选中的音轨可以点击音符。
我觉得前者适合，可以加一个mute、visible选项控制音轨以达到signal中的效果
数据结构？
### midi音符的结构
两个方案：所有轨都在一个数组中，和每轨一个数组，或者……两者结合
- 所有轨都在一个数组：可以一次遍历实现音符拾取，绘制也只要一次遍历
- 每轨一个数组：可以方便地实现单轨样式的应用，更改音轨顺序容易
- 两者结合：维护较为麻烦
需要实现的功能：
- 撤销重做: 用一个数组合适
- 单音轨播放(静音、乐器)：其实也是一个数组简单，因为播放的时候只需要维护一次遍历
- 多音轨拖拽：音符拾取是单音轨简单。拖拽影响的是selected数组，两者平局
综上，存放音符还是单个数组合适。要实现以上功能，只需要给音符加一个channel属性，而每个音轨的设置需要维护一个数组。

### 音轨的结构
音轨的添加采用动态添加的方式还是静态？wavetone是静态，最大16。我做动态吧。
动态音轨涉及很多ui的东西：音轨的位置（设计为可拖拽排序）、属性设置
需要暴露的接口：
- 音轨变化事件(顺序、个数)：用于触发存档点，目前考虑封装成Event
- 音轨状态(颜色、当前选中)
- 序列化音轨、根据音轨参数数组创建音轨：用于实现音轨的快照
ChannelList的音轨列表及其属性似乎不需要暴露
下一步推进的关键：
MidiPlayer！需要成为ChannelList和ChannelItem的公共可访问对象，然后完成ui和数据的绑定。ChannelItem的instrument是否需要用序号代替？
耦合关系：
MidiAction监听ChannelList的事件，而ChannelList不监听MidiAction，但受其控制
- ChannelList->音轨变化(顺序、个数)->MidiAction&MidiPlayer
    如何传递这个变化？改变顺序用reorder事件，删除用remove事件，添加似乎不涉及midi音符的操作。【修正：新增channel也需要事件，用于存档】
    删除一个channel时，先触发remove，再触发reorder，remove事件用于删除midi列表对应通道的音符，reorder用于更改剩下的音符的音轨序号
    由于reorder只在序号发生变化时触发，如果是最后一个删除或添加就不会触发，这意味着对此事件监听不能响应所有变化，那如何设置存档点？存档单独注册一个reorder的监听，add/remove前先取消注册，由add/remove自行设置存档，操作结束再注册回来，防止两次存档。
- ChannelList->音轨音量改变->MidiPlayer
- ChannelList<-选中音符<-MidiAction

### 撤销
本想改了什么存什么（以节省内存），但是没存的会丢失当前信息，所以必须midi和channel都存快照。

### 绘制
使用多音轨后，绘制逻辑需要改变
重叠：序号越低的音轨图层越上 & 选中的音轨置于顶层？——还是不要后者了。后者可以通过移动音轨实现
由于scroll相比刷新是稀疏的，可以维护一个“视野中的音符”列表insight，更新时机:
1. channelDiv的reorder
2. midi的增删移动改变长度。由于都会调用且最后调用changeNoteY，所以只需要在changeNoteY中调用
3. scroll2
4. deleteNote
5. ctrlZ、ctrlY
为了实现小序号音轨在上层，insight是一个列表的列表，每个列表中是一个音轨的视野内的音符。绘制的时候，倒序遍历绘制，同时查询是否显示。

## 音符播放技术要点
参考 https://github.com/g200kg/webaudio-tinysynth 完成了精简版的合成器，相比原版，有如下变化：
- 抽象为类，音色变成static属性。
- 用animationFrame而非timeInterval实现了音符检查与停止。
- 为了契合“动态音轨”的设计，合成器中以channel为单位组织数组，而非原版以audioNode为单位。
- 每个音轨的原型都是合成器，故可以单独拿出来使用。
- 没有做成midi的形式，音符频率依赖外部传参
- 没有实现通道的调制、左右声道、混响。
- 没有做鼓的音色。

## 音频播放
使用<audio>管理，因为方便。为了实现EQ效果：
```js
var source = audioContext.createMediaElementSource(audioElement);
var filter = audioContext.createBiquadFilter();
filter.type = 'lowpass';
filter.frequency.value = 1000;
source.connect(filter);
filter.connect(audioContext.destination);
```
仍然可以通过audioElement控制整体的播放。需要注意audioContext的状态：
如果是suspend，则需要resume(); audioContext刚创建就是这个状态，此时调用audioElement.play()无效。
但只要有osc被调用了start()，audioContext就会变成running。

## 不依赖音频的空白画布，即midi编辑器模式
由于使用了扒谱架构，同样需要确定时间精度（和一般midi编辑器不一样），因此需要复用onfile逻辑。
思想是替代Audio类，整理一下需要实现的功能：
- AudioPlayer.update: 用到了audio.readyState，audio.paused，audio.cuttentTime（更新app.time、重复区间）
- audio.readyState判断是否可以播放
- 设置audio.currentTime可以指定位置播放
- 设置audio.playbackRate可以指定播放速度
- 还有一些handler在createAudio中。

因此有了fakeAudio.js。

其次是Spectrogram._spectrogram，需要全部置为零（供绘制用）此外，查询Spectrogram._spectrogram以获取是否已经分析（onfile中据此判断是工作区否有文件，鼠标事件据此判断是否绘制音符）
于是设计了一个proxy，有length属性，用[][]访问总是零。

FakeAudio和这个Proxy的连接点在于时长，midi编辑器模式下总时长是会变的。于是借助setter完成了两者的数据关联。同时xnum也要能改变，于是也改为了setter。

## 去掉等待的动画
指一边分析一边把频谱绘制出来。改的地方：Array不能初始化好长度，每次应该用push添加元素造成Array.length在增加。每次更新进度条的地方改成频谱赋值。
这样确实能看到频谱生长出来，但是分析会导致此时的UI操作很卡顿。解决这个问题需要开worker后台计算，每次移交一个时刻的频谱。用了worker就不能双击打开了，不做。
此外这样意味着音频要先加载，如果出错了，会出现一堆未定义事件。
所以还是放弃。

## CQT
CQT太慢了。可以引入worker，后台计算，去掉进度条。或者先计算STFT，然后后台计算CQT。直接用CQT太唐氏了。
worker不能再双击打开的file协议下用，所以既然用了worker，不如CQT用wasm实现。
https://github.com/madderscientist/codeRoad/tree/main/TimeFrequency

## 关于Web Auido API的自动采样
当AudioContext的采样率和输入音频的采样率不一样的时候会发是什么？
https://dvcs.w3.org/hg/audio/raw-file/tip/webaudio/specification.html搜索“resample”可以看到会重新采样。问题是：是否会抗混叠滤波？
测试：首先创建了一个只含有一个G7音符（3136Hz）的midi，然后利用musescore转为WAV，采样率选择44100Hz。导入分析后，频谱符合预期。
改变AudioContext的采样率为4186Hz，如果抗混叠滤波，则这个G7肯定要被滤除。如果不抗混叠，则混叠到3136-(4186/2)=1043，位于C6（1046Hz）。
结果是在C6处出现了能量。所以不会抗混叠。