const audioInput = document.getElementById("audioInput");
const canvas = document.getElementById('spectrum');
const ctx = canvas.getContext('2d');
// copied！
function decodeMusic(file) {
    if (!audioBuffer) audioContext = new AudioContext({ sampleRate: 44100 });
    const fileReader = new FileReader();
    fileReader.onload = function () {
        const audioData = fileReader.result;
        // 解码音频文件为音频缓冲区
        audioContext.decodeAudioData(audioData, function (decodedData) {
            audioBuffer = decodedData;
        });
    };
    fileReader.readAsArrayBuffer(file);
}

function drawSpectrum(data) {
    ctx.lineWidth = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    var width = canvas.width / data.length;
    for (var i = 0; i < data.length; i++) {
        var x = i * width;
        var height = 5 * data[i] / 256 * canvas.height;
        ctx.moveTo(x, canvas.height);
        ctx.lineTo(x, canvas.height - height);
        ctx.arc(x, canvas.height - height, 2, 0, 2 * Math.PI);
    }
    ctx.strokeStyle = 'rgb(0,255,0)';
    ctx.stroke();
}

var audioContext = null;
var audioBuffer = null;
audioInput.onchange = function () {
    const file = audioInput.files[0];
    decodeMusic(file);
};

/**
 * 合并音频通道
 * @param {AudioBuffer} audioBuffer 含有多个通道的音频缓冲
 * @returns {Float32Array} 合并后的音频数据
 */
function mergeChannels(audioBuffer) {
    let numberOfChannels = audioBuffer.numberOfChannels;
    let length = audioBuffer.length;
    let output = new Float32Array(audioBuffer.getChannelData(0));
    if (numberOfChannels == 1) return output;
    for (let channel = 1; channel < numberOfChannels; channel++) {
        let channelData = audioBuffer.getChannelData(channel);
        for (let i = 0; i < length; i++) output[i] += channelData[i];
    }
    // 取平均
    for (var i = 0; i < length; i++) output[i] /= numberOfChannels;
    return output;
}

function analyse(tNum = 10, A4 = 440, channel = 2, fftPoints = 8192) {
    // 获取时域数据
    var timeDomain = null;
    switch (channel) {
        case 0: timeDomain = new Float32Array(audioBuffer.getChannelData(0)); break;
        case 1: timeDomain = new Float32Array(audioBuffer.getChannelData(1)); break;
        default: timeDomain = mergeChannels(audioBuffer); break;
    }
    // 创建分析工具
    var fft = new realFFT(fftPoints); // 8192点在44100采样率下，最低能分辨F#2，但是足矣
    var analyser = new NoteAnalyser(audioBuffer.sampleRate / fftPoints, A4);
    var result = [];
    // 开始分析
    let dN = Math.round(audioBuffer.sampleRate / tNum);
    let nFinal = timeDomain.length - fftPoints;
    for (let n = 0; n < nFinal; n += dN) {
        result.push(analyser.analyse(...fft.fft(timeDomain, n)));
    }
    return result;
}


function testFFT(t = 4410) {
    var timeDomain = mergeChannels(audioBuffer);
    // var fft = new realFFT(8192);
    // let amplitude = realFFT.ComplexAbs(...fft.fft(timeDomain, t)); // 777点到C8
    // drawSpectrum(amplitude);
    var fft = new realFFT(8192);
    var analyser = new NoteAnalyser(audioBuffer.sampleRate / 8192, 440);
    console.log(analyser);

    let x = fft.fft(timeDomain, t)
    let amplitude = realFFT.ComplexAbs(...x); // 777点到C8
    drawSpectrum(amplitude);
    drawNote();
    return analyser.analyse(...x);
}
function drawNote() {
    let s = ['#ff0000','#ff000f','#ff00f0','#ff00ff','#ff0f00','#ff0f0f','#ff0ff0','#ff0aaa','#ffa000','#ff900a','#ff9080','#ffa06a'];
    let df = audioBuffer.sampleRate / 8192;
    ctx.lineWidth = 1;
    let per = 4;
    var analyser = new NoteAnalyser(df, 440);
    for(let i = 0; i<analyser.freqTable.length; i++) {
        let ii = i%12;
        ctx.strokeStyle = s[ii];
        let center = Math.round(analyser.freqTable[i]/df) * per;
        ctx.strokeRect(center - per, 120*ii+200, 2*per, canvas.height-100);
    }
}