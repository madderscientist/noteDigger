// 是https://github.com/g200kg/webaudio-tinysynth的精简版
class TinySynth {
    static soundFont = {};    // 最终是填补了默认值的TinySynth.wave
    static defaultWave = { g: 0, w: "sine", t: 1, f: 0, v: 0.5, a: 0, h: 0.01, d: 0.01, s: 0, r: 0.05, p: 1, q: 1, k: 0 };
    static instrument = [
/* 1-8 : Piano */	"Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi",
/* 9-16 : Chromatic Perc */	"Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
/* 17-24 : Organ */	"Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
/* 25-32 : Guitar */	"Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar harmonics",
/* 33-40 : Bass */	"Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
/* 41-48 : Strings */	"Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
/* 49-56 : Ensamble */	"String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
/* 57-64 : Brass */	"Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2",
/* 65-72 : Reed */	"Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
/* 73-80 : Pipe */	"Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
/* 81-88 : SynthLead */	"Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
/* 89-96 : SynthPad */	"Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
/* 97-104 : FX */	"FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
/* 105-112 : Ethnic */	"Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag pipe", "Fiddle", "Shanai",
/* 113-120 : Percussive */	"Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
/* 121-128 : SE */	"Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
    ];
    static wave = [
        /* 1-8 : Piano */
        [{ w: "sine", v: .4, d: 0.7, r: 0.1 }, { w: "triangle", v: 3, d: 0.7, s: 0.1, g: 1, a: 0.01, k: -1.2 }],
        [{ w: "triangle", v: 0.4, d: 0.7, r: 0.1 }, { w: "triangle", v: 4, t: 3, d: 0.4, s: 0.1, g: 1, k: -1, a: 0.01 }],
        [{ w: "sine", d: 0.7, r: 0.1 }, { w: "triangle", v: 4, f: 2, d: 0.5, s: 0.5, g: 1, k: -1 }],
        [{ w: "sine", d: 0.7, v: 0.2 }, { w: "triangle", v: 4, t: 3, f: 2, d: 0.3, g: 1, k: -1, a: 0.01, s: 0.5 }],
        [{ w: "sine", v: 0.35, d: 0.7 }, { w: "sine", v: 3, t: 7, f: 1, d: 1, s: 1, g: 1, k: -.7 }],
        [{ w: "sine", v: 0.35, d: 0.7 }, { w: "sine", v: 8, t: 7, f: 1, d: 0.5, s: 1, g: 1, k: -.7 }],
        [{ w: "sawtooth", v: 0.34, d: 2 }, { w: "sine", v: 8, f: 0.1, d: 2, s: 1, r: 2, g: 1 }],
        [{ w: "triangle", v: 0.34, d: 1.5 }, { w: "square", v: 6, f: 0.1, d: 1.5, s: 0.5, r: 2, g: 1 }],
        /* 9-16 : Chromatic Perc*/
        [{ w: "sine", d: 0.3, r: 0.3 }, { w: "sine", v: 7, t: 11, d: 0.03, g: 1 }],
        [{ w: "sine", d: 0.3, r: 0.3 }, { w: "sine", v: 11, t: 6, d: 0.2, s: 0.4, g: 1 }],
        [{ w: "sine", v: 0.2, d: 0.3, r: 0.3 }, { w: "sine", v: 11, t: 5, d: 0.1, s: 0.4, g: 1 }],
        [{ w: "sine", v: 0.2, d: 0.6, r: 0.6 }, { w: "triangle", v: 11, t: 5, f: 1, s: 0.5, g: 1 }],
        [{ w: "sine", v: 0.3, d: 0.2, r: 0.2 }, { w: "sine", v: 6, t: 5, d: 0.02, g: 1 }],
        [{ w: "sine", v: 0.3, d: 0.2, r: 0.2 }, { w: "sine", v: 7, t: 11, d: 0.03, g: 1 }],
        [{ w: "sine", v: 0.2, d: 1, r: 1 }, { w: "sine", v: 11, t: 3.5, d: 1, r: 1, g: 1 }],
        [{ w: "triangle", v: 0.2, d: 0.5, r: 0.2 }, { w: "sine", v: 6, t: 2.5, d: 0.2, s: 0.1, r: 0.2, g: 1 }],
        /* 17-24 : Organ */
        [{ w: "w9999", v: 0.22, s: 0.9 }, { w: "w9999", v: 0.22, t: 2, f: 2, s: 0.9 }],
        [{ w: "w9999", v: 0.2, s: 1 }, { w: "sine", v: 11, t: 6, f: 2, s: 0.1, g: 1, h: 0.006, r: 0.002, d: 0.002 }, { w: "w9999", v: 0.2, t: 2, f: 1, h: 0, s: 1 }],
        [{ w: "w9999", v: 0.2, d: 0.1, s: 0.9 }, { w: "w9999", v: 0.25, t: 4, f: 2, s: 0.5 }],
        [{ w: "w9999", v: 0.3, a: 0.04, s: 0.9 }, { w: "w9999", v: 0.2, t: 8, f: 2, a: 0.04, s: 0.9 }],
        [{ w: "sine", v: 0.2, a: 0.02, d: 0.05, s: 1 }, { w: "sine", v: 6, t: 3, f: 1, a: 0.02, d: 0.05, s: 1, g: 1 }],
        [{ w: "triangle", v: 0.2, a: 0.02, d: 0.05, s: 0.8 }, { w: "square", v: 7, t: 3, f: 1, d: 0.05, s: 1.5, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 0.2, s: 0.5 }, { w: "square", v: 1, d: 0.03, s: 2, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 0.1, s: 0.8 }, { w: "square", v: 1, a: 0.3, d: 0.1, s: 2, g: 1 }],
        /* 25-32 : Guitar */
        [{ w: "sine", v: 0.3, d: 0.5, f: 1 }, { w: "triangle", v: 5, t: 3, f: -1, d: 1, s: 0.1, g: 1 }],
        [{ w: "sine", v: 0.4, d: 0.6, f: 1 }, { w: "triangle", v: 12, t: 3, d: 0.6, s: 0.1, g: 1, f: -1 }],
        [{ w: "triangle", v: 0.3, d: 1, f: 1 }, { w: "triangle", v: 6, f: -1, d: 0.4, s: 0.5, g: 1, t: 3 }],
        [{ w: "sine", v: 0.3, d: 1, f: -1 }, { w: "triangle", v: 11, f: 1, d: 0.4, s: 0.5, g: 1, t: 3 }],
        [{ w: "sine", v: 0.4, d: 0.1, r: 0.01 }, { w: "sine", v: 7, g: 1 }],
        [{ w: "triangle", v: 0.4, d: 1, f: 1 }, { w: "square", v: 4, f: -1, d: 1, s: 0.7, g: 1 }],//[{w:"triangle",v:0.35,d:1,f:1,},{w:"square",v:7,f:-1,d:0.3,s:0.5,g:1,}],
        [{ w: "triangle", v: 0.35, d: 1, f: 1 }, { w: "square", v: 7, f: -1, d: 0.3, s: 0.5, g: 1 }],//[{w:"triangle",v:0.4,d:1,f:1,},{w:"square",v:4,f:-1,d:1,s:0.7,g:1,}],//[{w:"triangle",v:0.4,d:1,},{w:"square",v:4,f:2,d:1,s:0.7,g:1,}],
        [{ w: "sine", v: 0.2, t: 1.5, a: 0.005, h: 0.2, d: 0.6 }, { w: "sine", v: 11, t: 5, f: 2, d: 1, s: 0.5, g: 1 }],
        /* 33-40 : Bass */
        [{ w: "sine", d: 0.3 }, { w: "sine", v: 4, t: 3, d: 1, s: 1, g: 1 }],
        [{ w: "sine", d: 0.3 }, { w: "sine", v: 4, t: 3, d: 1, s: 1, g: 1 }],
        [{ w: "w9999", d: 0.3, v: 0.7, s: 0.5 }, { w: "sawtooth", v: 1.2, d: 0.02, s: 0.5, g: 1, h: 0, r: 0.02 }],
        [{ w: "sine", d: 0.3 }, { w: "sine", v: 4, t: 3, d: 1, s: 1, g: 1 }],
        [{ w: "triangle", v: 0.3, t: 2, d: 1 }, { w: "triangle", v: 15, t: 2.5, d: 0.04, s: 0.1, g: 1 }],
        [{ w: "triangle", v: 0.3, t: 2, d: 1 }, { w: "triangle", v: 15, t: 2.5, d: 0.04, s: 0.1, g: 1 }],
        [{ w: "triangle", d: 0.7 }, { w: "square", v: 0.4, t: 0.5, f: 1, d: 0.2, s: 10, g: 1 }],
        [{ w: "triangle", d: 0.7 }, { w: "square", v: 0.4, t: 0.5, f: 1, d: 0.2, s: 10, g: 1 }],
        /* 41-48 : Strings */
        [{ w: "sawtooth", v: 0.4, a: 0.1, d: 11 }, { w: "sine", v: 5, d: 11, s: 0.2, g: 1 }],
        [{ w: "sawtooth", v: 0.4, a: 0.1, d: 11 }, { w: "sine", v: 5, d: 11, s: 0.2, g: 1 }],
        [{ w: "sawtooth", v: 0.4, a: 0.1, d: 11 }, { w: "sine", v: 5, t: 0.5, d: 11, s: 0.2, g: 1 }],
        [{ w: "sawtooth", v: 0.4, a: 0.1, d: 11 }, { w: "sine", v: 5, t: 0.5, d: 11, s: 0.2, g: 1 }],
        [{ w: "sine", v: 0.4, a: 0.1, d: 11 }, { w: "sine", v: 6, f: 2.5, d: 0.05, s: 1.1, g: 1 }],
        [{ w: "sine", v: 0.3, d: 0.1, r: 0.1 }, { w: "square", v: 4, t: 3, d: 1, s: 0.2, g: 1 }],
        [{ w: "sine", v: 0.3, d: 0.5, r: 0.5 }, { w: "sine", v: 7, t: 2, f: 2, d: 1, r: 1, g: 1 }],
        [{ w: "triangle", v: 0.6, h: 0.03, d: 0.3, r: 0.3, t: 0.5 }, { w: "n0", v: 8, t: 1.5, d: 0.08, r: 0.08, g: 1 }],
        /* 49-56 : Ensamble */
        [{ w: "sawtooth", v: 0.3, a: 0.03, s: 0.5 }, { w: "sawtooth", v: 0.2, t: 2, f: 2, d: 1, s: 2 }],
        [{ w: "sawtooth", v: 0.3, f: -2, a: 0.03, s: 0.5 }, { w: "sawtooth", v: 0.2, t: 2, f: 2, d: 1, s: 2 }],
        [{ w: "sawtooth", v: 0.2, a: 0.02, s: 1 }, { w: "sawtooth", v: 0.2, t: 2, f: 2, a: 1, d: 1, s: 1 }],
        [{ w: "sawtooth", v: 0.2, a: 0.02, s: 1 }, { w: "sawtooth", v: 0.2, f: 2, a: 0.02, d: 1, s: 1 }],
        [{ w: "triangle", v: 0.3, a: 0.03, s: 1 }, { w: "sine", v: 3, t: 5, f: 1, d: 1, s: 1, g: 1 }],
        [{ w: "sine", v: 0.4, a: 0.03, s: 0.9 }, { w: "sine", v: 1, t: 2, f: 3, d: 0.03, s: 0.2, g: 1 }],
        [{ w: "triangle", v: 0.6, a: 0.05, s: 0.5 }, { w: "sine", v: 1, f: 0.8, d: 0.2, s: 0.2, g: 1 }],
        [{ w: "square", v: 0.15, a: 0.01, d: 0.2, r: 0.2, t: 0.5, h: 0.03 }, { w: "square", v: 4, f: 0.5, d: 0.2, r: 11, a: 0.01, g: 1, h: 0.02 }, { w: "square", v: 0.15, t: 4, f: 1, a: 0.02, d: 0.15, r: 0.15, h: 0.03 }, { g: 3, w: "square", v: 4, f: -0.5, a: 0.01, h: 0.02, d: 0.15, r: 11 }],
        /* 57-64 : Brass */
        [{ w: "square", v: 0.2, a: 0.01, d: 1, s: 0.6, r: 0.04 }, { w: "sine", v: 1, d: 0.1, s: 4, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 1, s: 0.5, r: 0.08 }, { w: "sine", v: 1, d: 0.1, s: 4, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.04, d: 1, s: 0.4, r: 0.08 }, { w: "sine", v: 1, d: 0.1, s: 4, g: 1 }],
        [{ w: "square", v: 0.15, a: 0.04, s: 1 }, { w: "sine", v: 2, d: 0.1, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 1, s: 0.5, r: 0.08 }, { w: "sine", v: 1, d: 0.1, s: 4, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 1, s: 0.6, r: 0.08 }, { w: "sine", v: 1, f: 0.2, d: 0.1, s: 4, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 0.5, s: 0.7, r: 0.08 }, { w: "sine", v: 1, d: 0.1, s: 4, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 1, s: 0.5, r: 0.08 }, { w: "sine", v: 1, d: 0.1, s: 4, g: 1 }],
        /* 65-72 : Reed */
        [{ w: "square", v: 0.2, a: 0.02, d: 2, s: 0.6 }, { w: "sine", v: 2, d: 1, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 2, s: 0.6 }, { w: "sine", v: 2, d: 1, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 1, s: 0.6 }, { w: "sine", v: 2, d: 1, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.02, d: 1, s: 0.6 }, { w: "sine", v: 2, d: 1, g: 1 }],
        [{ w: "sine", v: 0.4, a: 0.02, d: 0.7, s: 0.5 }, { w: "square", v: 5, t: 2, d: 0.2, s: 0.5, g: 1 }],
        [{ w: "sine", v: 0.3, a: 0.05, d: 0.2, s: 0.8 }, { w: "sawtooth", v: 6, f: 0.1, d: 0.1, s: 0.3, g: 1 }],
        [{ w: "sine", v: 0.3, a: 0.03, d: 0.2, s: 0.4 }, { w: "square", v: 7, f: 0.2, d: 1, s: 0.1, g: 1 }],
        [{ w: "square", v: 0.2, a: 0.05, d: 0.1, s: 0.8 }, { w: "square", v: 4, d: 0.1, s: 1.1, g: 1 }],
        /* 73-80 : Pipe */
        [{ w: "sine", a: 0.02, d: 2 }, { w: "sine", v: 6, t: 2, d: 0.04, g: 1 }],
        [{ w: "sine", v: 0.7, a: 0.03, d: 0.4, s: 0.4 }, { w: "sine", v: 4, t: 2, f: 0.2, d: 0.4, g: 1 }],
        [{ w: "sine", v: 0.7, a: 0.02, d: 0.4, s: 0.6 }, { w: "sine", v: 3, t: 2, d: 0, s: 1, g: 1 }],
        [{ w: "sine", v: 0.4, a: 0.06, d: 0.3, s: 0.3 }, { w: "sine", v: 7, t: 2, d: 0.2, s: 0.2, g: 1 }],
        [{ w: "sine", a: 0.02, d: 0.3, s: 0.3 }, { w: "sawtooth", v: 3, t: 2, d: 0.3, g: 1 }],
        [{ w: "sine", v: 0.4, a: 0.02, d: 2, s: 0.1 }, { w: "sawtooth", v: 8, t: 2, f: 1, d: 0.5, g: 1 }],
        [{ w: "sine", v: 0.7, a: 0.03, d: 0.5, s: 0.3 }, { w: "sine", v: 0.003, t: 0, f: 4, d: 0.1, s: 0.002, g: 1 }],
        [{ w: "sine", v: 0.7, a: 0.02, d: 2 }, { w: "sine", v: 1, t: 2, f: 1, d: 0.02, g: 1 }],
        /* 81-88 : SynthLead */
        [{ w: "square", v: 0.3, d: 1, s: 0.5 }, { w: "square", v: 1, f: 0.2, d: 1, s: 0.5, g: 1 }],
        [{ w: "sawtooth", v: 0.3, d: 2, s: 0.5 }, { w: "square", v: 2, f: 0.1, s: 0.5, g: 1 }],
        [{ w: "triangle", v: 0.5, a: 0.05, d: 2, s: 0.6 }, { w: "sine", v: 4, t: 2, g: 1 }],
        [{ w: "triangle", v: 0.3, a: 0.01, d: 2, s: 0.3 }, { w: "sine", v: 22, t: 2, f: 1, d: 0.03, s: 0.2, g: 1 }],
        [{ w: "sawtooth", v: 0.3, d: 1, s: 0.5 }, { w: "sine", v: 11, t: 11, a: 0.2, d: 0.05, s: 0.3, g: 1 }],
        [{ w: "sine", v: 0.3, a: 0.06, d: 1, s: 0.5 }, { w: "sine", v: 7, f: 1, d: 1, s: 0.2, g: 1 }],
        [{ w: "sawtooth", v: 0.3, a: 0.03, d: 0.7, s: 0.3, r: 0.2 }, { w: "sawtooth", v: 0.3, t: 0.75, d: 0.7, a: 0.1, s: 0.3, r: 0.2 }],
        [{ w: "triangle", v: 0.3, a: 0.01, d: 0.7, s: 0.5 }, { w: "square", v: 5, t: 0.5, d: 0.7, s: 0.5, g: 1 }],
        /* 89-96 : SynthPad */
        [{ w: "triangle", v: 0.3, a: 0.02, d: 0.3, s: 0.3, r: 0.3 }, { w: "square", v: 3, t: 4, f: 1, a: 0.02, d: 0.1, s: 1, g: 1 }, { w: "triangle", v: 0.08, t: 0.5, a: 0.1, h: 0, d: 0.1, s: 0.5, r: 0.1, b: 0, c: 0 }],
        [{ w: "sine", v: 0.3, a: 0.05, d: 1, s: 0.7, r: 0.3 }, { w: "sine", v: 2, f: 1, d: 0.3, s: 1, g: 1 }],
        [{ w: "square", v: 0.3, a: 0.03, d: 0.5, s: 0.3, r: 0.1 }, { w: "square", v: 4, f: 1, a: 0.03, d: 0.1, g: 1 }],
        [{ w: "triangle", v: 0.3, a: 0.08, d: 1, s: 0.3, r: 0.1 }, { w: "square", v: 2, f: 1, d: 0.3, s: 0.3, g: 1, t: 4, a: 0.08 }],
        [{ w: "sine", v: 0.3, a: 0.05, d: 1, s: 0.3, r: 0.1 }, { w: "sine", v: 0.1, t: 2.001, f: 1, d: 1, s: 50, g: 1 }],
        [{ w: "triangle", v: 0.3, a: 0.03, d: 0.7, s: 0.3, r: 0.2 }, { w: "sine", v: 12, t: 7, f: 1, d: 0.5, s: 1.7, g: 1 }],
        [{ w: "sine", v: 0.3, a: 0.05, d: 1, s: 0.3, r: 0.1 }, { w: "sawtooth", v: 22, t: 6, d: 0.06, s: 0.3, g: 1 }],
        [{ w: "triangle", v: 0.3, a: 0.05, d: 11, r: 0.3 }, { w: "triangle", v: 1, d: 1, s: 8, g: 1 }],
        /* 97-104 : FX */
        [{ w: "sawtooth", v: 0.3, d: 4, s: 0.8, r: 0.1 }, { w: "square", v: 1, t: 2, f: 8, a: 1, d: 1, s: 1, r: 0.1, g: 1 }],
        [{ w: "triangle", v: 0.3, d: 1, s: 0.5, t: 0.8, a: 0.2, p: 1.25, q: 0.2 }, { w: "sawtooth", v: 0.2, a: 0.2, d: 0.3, s: 1, t: 1.2, p: 1.25, q: 0.2 }],
        [{ w: "sine", v: 0.3, d: 1, s: 0.3 }, { w: "square", v: 22, t: 11, d: 0.5, s: 0.1, g: 1 }],
        [{ w: "sawtooth", v: 0.3, a: 0.04, d: 1, s: 0.8, r: 0.1 }, { w: "square", v: 1, t: 0.5, d: 1, s: 2, g: 1 }],
        [{ w: "triangle", v: 0.3, d: 1, s: 0.3 }, { w: "sine", v: 22, t: 6, d: 0.6, s: 0.05, g: 1 }],
        [{ w: "sine", v: 0.6, a: 0.1, d: 0.05, s: 0.4 }, { w: "sine", v: 5, t: 5, f: 1, d: 0.05, s: 0.3, g: 1 }],
        [{ w: "sine", a: 0.1, d: 0.05, s: 0.4, v: 0.8 }, { w: "sine", v: 5, t: 5, f: 1, d: 0.05, s: 0.3, g: 1 }],
        [{ w: "square", v: 0.3, a: 0.1, d: 0.1, s: 0.4 }, { w: "square", v: 1, f: 1, d: 0.3, s: 0.1, g: 1 }],
        /* 105-112 : Ethnic */
        [{ w: "sawtooth", v: 0.3, d: 0.5, r: 0.5 }, { w: "sawtooth", v: 11, t: 5, d: 0.05, g: 1 }],
        [{ w: "square", v: 0.3, d: 0.2, r: 0.2 }, { w: "square", v: 7, t: 3, d: 0.05, g: 1 }],
        [{ w: "triangle", d: 0.2, r: 0.2 }, { w: "square", v: 9, t: 3, d: 0.1, r: 0.1, g: 1 }],
        [{ w: "triangle", d: 0.3, r: 0.3 }, { w: "square", v: 6, t: 3, d: 1, r: 1, g: 1 }],
        [{ w: "triangle", v: 0.4, d: 0.2, r: 0.2 }, { w: "square", v: 22, t: 12, d: 0.1, r: 0.1, g: 1 }],
        [{ w: "sine", v: 0.25, a: 0.02, d: 0.05, s: 0.8 }, { w: "square", v: 1, t: 2, d: 0.03, s: 11, g: 1 }],
        [{ w: "sine", v: 0.3, a: 0.05, d: 11 }, { w: "square", v: 7, t: 3, f: 1, s: 0.7, g: 1 }],
        [{ w: "square", v: 0.3, a: 0.05, d: 0.1, s: 0.8 }, { w: "square", v: 4, d: 0.1, s: 1.1, g: 1 }],
        /* 113-120 : Percussive */
        [{ w: "sine", v: 0.4, d: 0.3, r: 0.3 }, { w: "sine", v: 7, t: 9, d: 0.1, r: 0.1, g: 1 }],
        [{ w: "sine", v: 0.7, d: 0.1, r: 0.1 }, { w: "sine", v: 22, t: 7, d: 0.05, g: 1 }],
        [{ w: "sine", v: 0.6, d: 0.15, r: 0.15 }, { w: "square", v: 11, t: 3.2, d: 0.1, r: 0.1, g: 1 }],
        [{ w: "sine", v: 0.8, d: 0.07, r: 0.07 }, { w: "square", v: 11, t: 7, r: 0.01, g: 1 }],
        [{ w: "triangle", v: 0.7, t: 0.5, d: 0.2, r: 0.2, p: 0.95 }, { w: "n0", v: 9, g: 1, d: 0.2, r: 0.2 }],
        [{ w: "sine", v: 0.7, d: 0.1, r: 0.1, p: 0.9 }, { w: "square", v: 14, t: 2, d: 0.005, r: 0.005, g: 1 }],
        [{ w: "square", d: 0.15, r: 0.15, p: 0.5 }, { w: "square", v: 4, t: 5, d: 0.001, r: 0.001, g: 1 }],
        [{ w: "n1", v: 0.3, a: 1, s: 1, d: 0.15, r: 0, t: 0.5 }],
        /* 121-128 : SE */
        [{ w: "sine", t: 12.5, d: 0, r: 0, p: 0.5, v: 0.3, h: 0.2, q: 0.5 }, { g: 1, w: "sine", v: 1, t: 2, d: 0, r: 0, s: 1 }, { g: 1, w: "n0", v: 0.2, t: 2, a: 0.6, h: 0, d: 0.1, r: 0.1, b: 0, c: 0 }],
        [{ w: "n0", v: 0.2, a: 0.05, h: 0.02, d: 0.02, r: 0.02 }],
        [{ w: "n0", v: 0.4, a: 1, d: 1, t: 0.25 }],
        [{ w: "sine", v: 0.3, a: 0.1, d: 1, s: 0.5 }, { w: "sine", v: 4, t: 0, f: 1.5, d: 1, s: 1, r: 0.1, g: 1 }, { g: 1, w: "sine", v: 4, t: 0, f: 2, a: 0.6, h: 0, d: 0.1, s: 1, r: 0.1, b: 0, c: 0 }],
        [{ w: "square", v: 0.3, t: 0.25, d: 11, s: 1 }, { w: "square", v: 12, t: 0, f: 8, d: 1, s: 1, r: 11, g: 1 }],
        [{ w: "n0", v: 0.4, t: 0.5, a: 1, d: 11, s: 1, r: 0.5 }, { w: "square", v: 1, t: 0, f: 14, d: 1, s: 1, r: 11, g: 1 }],
        [{ w: "sine", t: 0, f: 1221, a: 0.2, d: 1, r: 0.25, s: 1 }, { g: 1, w: "n0", v: 3, t: 0.5, d: 1, s: 1, r: 1 }],
        [{ w: "sine", d: 0.4, r: 0.4, p: 0.1, t: 2.5, v: 1 }, { w: "n0", v: 12, t: 2, d: 1, r: 1, g: 1 }],
    ];
    /**
     * 填充音色默认参数
     * @param {Object} options 配置选项
     * @param {Number} [options.g=0] - output destination 0=final output / n=FM to specified osc即将FM效果应用在第几个osc上
     * @param {String} [options.w="sine"] - wave type 波形类型 sine/square/sawtooth/triangle/w9999
     * @param {Number} [options.t=1] - tune factor according to note#
     * @param {Number} [options.f=0] - delta频率 在基频上面加的 f' = f0*t+f
     * @param {Number} [options.v=0.5] - volume 音量 0~1
     * @param {Number} [options.a=0] - attack time in seconds
     * @param {Number} [options.h=0.01] - hold time in seconds
     * @param {Number} [options.d=0.01] - decay time in seconds
     * @param {Number} [options.s=0] - sustain level 声音在按键持续按下期间的音量
     * @param {Number} [options.r=0.05] - release time in seconds
     * @param {Number} [options.p=1] - pitch bend 频率变化因数(乘)
     * @param {Number} [options.q=1] - pitch bend speed factor in seconds 从freq到freq*p所需秒数
     * @param {Number} [options.k=0] - volume key tracking factor 在真实的乐器中，音量往往会随着音高的变化而变化
     */
    static initSoundFont({ g, w, t, f, v, a, h, d, s, r, p, q, k } = TinySynth.defaultWave) {
        // 默认的波形参数，用于填充每个基本波中缺失的默认参数
        const defp = { g: g, w: w, t: t, f: f, v: v, a: a, h: h, d: d, s: s, r: r, p: p, q: q, k: k };
        for (let i = 0; i < TinySynth.instrument.length; i++) {
            // 用的是复制，目的是防止修改TinySynth.wave。此函数可多次调用，改变全局音色
            TinySynth.soundFont[TinySynth.instrument[i]] = Array.from(TinySynth.wave[i], (v) => Object.assign({}, defp, v));
        } console.log("音色库初始化完毕");
    }
    static initOneSoundFont(id, { g, w, t, f, v, a, h, d, s, r, p, q, k } = TinySynth.defaultWave) {
        const defp = { g: g, w: w, t: t, f: f, v: v, a: a, h: h, d: d, s: s, r: r, p: p, q: q, k: k };
        TinySynth.soundFont[TinySynth.instrument[id]] = Array.from(TinySynth.wave[id], (v) => Object.assign({}, defp, v));
    }
    static midi_instrument(id) {
        return TinySynth.soundFont[TinySynth.instrument[id]];
    }
    constructor(actx = new AudioContext(), loadAll = false) {
        if (loadAll) {
            TinySynth.initSoundFont();
            Object.defineProperty(this, "instrument", {
                set: function (id) { this._instrument = id; },
                get: function () { return this._instrument; }
            }); console.log("模式: 初始化所有音色");
        } else {
            Object.defineProperty(this, "instrument", {
                set: function (id) {
                    const name = TinySynth.instrument[id];
                    if (!TinySynth.soundFont[name]) TinySynth.initOneSoundFont(id);
                    this._instrument = id;
                },
                get: function () { return this._instrument; }
            }); console.log("模式: 运行时加载音色");    // 初始时大约能小3M运行内存
        }
        this.channel = [];  // 维护一个数组，用于存放所有的channel。如果要改变顺序需要外部更改
        this.notes = [];    // 存放所有正在playing的note
        this.instrument = 0;
        this.audioContext = actx;
        const check = () => {
            this.checkStop();
            window.requestAnimationFrame(check);
        }
        window.requestAnimationFrame(check);
    }
    get audioContext() {
        return this.actx;
    }
    set audioContext(actx) {
        this.actx = actx;
        this.out = this.actx.createGain();    // 总音量
        this.comp = this.actx.createDynamicsCompressor();
        this.out.connect(this.comp);
        this.comp.connect(actx.destination);
        for (const ch of this.channel) {
            ch.out = actx.createGain();
        }
        // 不在默认波形中的波形集合
        this.wave = { "w9999": actx.createPeriodicWave(new Float32Array(5), new Float32Array([0, 9, 9, 9, 9])) };
        // 噪声
        var blen = this.actx.sampleRate >> 1;
        this.noiseBuf = {
            n0: this.actx.createBuffer(1, blen, this.actx.sampleRate),
            n1: this.actx.createBuffer(1, blen, this.actx.sampleRate)
        };
        let dn = this.noiseBuf.n0.getChannelData(0);
        let dr = this.noiseBuf.n1.getChannelData(0);
        for (let i = 0; i < blen; i++) {
            dn[i] = Math.random() * 2 - 1;// 范围[-1, 1]，白噪声
        }
        // 生成一个包含64*2个不同频率的正弦波的音频缓冲区
        for (let jj = 0; jj < 64; ++jj) {
            const r1 = Math.random() * 10 + 1;
            const r2 = Math.random() * 10 + 1;
            for (let i = 0; i < blen; ++i) {
                // 频率是r1和r2
                let dd = Math.sin((i / blen) * 2 * Math.PI * 440 * r1) * Math.sin((i / blen) * 2 * Math.PI * 440 * r2);
                dr[i] += dd / 8;
            }
        }
    }
    /**
     * 平方律，根据增益获取音量，正常范围0~127
     */
    get volume() {
        return Math.round(Math.sqrt(this.out.gain.value * 16129));
    }
    /**
     * 平方律，根据音量设置增益
     * @param {Number} v 自然数音量
     */
    set volume(v) {
        this.out.gain.value = v * v / 16129;
    }
    /**
     * 创建一个节点
     * @param {Number} at 插入在native channel的位置，undefined表示最后，负数表示倒数
     * @returns {Object} {out: GainNode}
     */
    addChannel(at = this.channel.length, instrument = 0, gain = 1) {
        if (!this.channel) return null;   // 防止此函数返回的obj调用
        const out = this.actx.createGain();
        const ch = {out: out};
        out.gain.value = gain;
        out.connect(this.out);
        Object.setPrototypeOf(ch, this);
        ch.instrument = instrument; // 触发setter
        this.channel.splice(at, 0, ch);
        return ch;
    }
    /**
     * 播放声音
     * @param {Object} options 音符播放参数
     * @param {Number} [options.id] - channel的id，如果不传或违规则用自身 决定了音色
     * @param {Number} [options.f=440] - 发生频率
     * @param {Number} [options.v=127] - 力度，最大127 会按平方律变为音量
     * @param {Number} [options.t=0] - 发声时间(秒) 如果小于零则在this.actx.currentTime基础上加其绝对值
     * @param {Number} [options.last=9999] - 持续时间(秒)
     * @returns {Object} note = {ch, end, gain, release}
     */
    play({ id, f = 440, v = 127, t = 0, last = 9999 } = {}) {
        if (last <= 0) return;
        const ch = id === void 0 ? this : (this.channel && this.channel[id] ? this.channel[id] : this);
        const instrument = TinySynth.soundFont[TinySynth.instrument[ch.instrument]];
        const osc = new Array(instrument.length);
        const gain = new Array(instrument.length);
        const freq = new Array(instrument.length);
        const release = new Array(instrument.length);
        if (t < 0) t = this.actx.currentTime - t;
        else t = t < this.actx.currentTime ? this.actx.currentTime : t;
        // 共用的变量
        let out, A_rate, volume, o;
        for (let i = 0; i < instrument.length; i++) {
            const p = instrument[i];
            if (p.g == 0) {  // 0表明是发声的
                out = ch.out;
                A_rate = v * v / 16129;     // 平方律设置归一化振幅
                freq[i] = f * p.t + p.f;
            } else if (p.g > 0) {   // FM调制
                if (osc[p.g - 1].frequency) {
                    out = osc[p.g - 1].frequency;
                    A_rate = freq[p.g - 1];
                } else {    // 如果是噪声，则osc是一个bufferSource，没有frequency属性
                    out = osc[p.g - 1].playbackRate;
                    A_rate = freq[p.g - 1] / 440;
                }
                freq[i] = freq[p.g - 1] * p.t + p.f;
            } else {                // AM调制
                out = gain[-p.g - 1].gain;
                A_rate = 1;
            }
            // 振荡器 波形
            if (p.w[0] == 'n') {    // 噪声
                o = this.actx.createBufferSource();
                o.buffer = this.noiseBuf[p.w];
                o.loop = true;
                o.playbackRate.value = freq[i] / 440;
                if (p.p != 1) o.playbackRate.setTargetAtTime(freq[i] * p.p / 440, t, p.q);
            } else {
                o = this.actx.createOscillator();
                o.frequency.value = freq[i];
                if (p.p != 1) o.frequency.setTargetAtTime(freq[i] * p.p, t, p.q)
                if (p.w[0] == 'w') o.setPeriodicWave(this.wave[p.w]);
                else o.type = p.w;
            } osc[i] = o;

            volume = A_rate * p.v;
            if (p.k) volume *= Math.pow(f / 261.6, p.k);   // 261.6是中央C的频率 k一般是负数，表示音越高，音量越小
            release[i] = p.r;

            const g = this.actx.createGain();
            if (p.a) {   // 包络的A
                g.gain.value = 0;
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(volume, t + p.a);
            } else g.gain.setValueAtTime(volume, t);
            // 包络的H、D和S
            g.gain.setTargetAtTime(p.s * volume, t + p.a + p.h, p.d);
            gain[i] = g;

            o.connect(g); g.connect(out); o.start(t);
        }
        const note = {   // 用于停止
            ch: ch,
            end: t + last,  // end表示结束时间，恒大于零，如果小于零表示已经停止(手动停止)，不需要再次停止
            gain: gain, osc: osc,
            release: release
        };
        this.notes.push(note);
        return note;
    }
    stop(nt, t = 0) {
        if (t < 0) t = this.actx.currentTime - t;
        else t = t < this.actx.currentTime ? this.actx.currentTime : t;
        let promises = nt.osc.map((osc, i) => {
            return new Promise(resolve => {
                osc.onended = resolve;
                nt.gain[i].gain.cancelScheduledValues(t);
                // 包络的R
                nt.gain[i].gain.setTargetAtTime(0, t, nt.release[i]);
                osc.stop(t + nt.release[i]);
                nt.gain[i].gain.cancelScheduledValues(t + nt.release[i]);
            });
        });
        Promise.all(promises).then(() => {
            nt.end = -1;    // 标记为已经停止
        });   // 在所有osc都结束后的操作
    }
    checkStop() {   // 自动回收 一直开启
        const t = this.actx.currentTime;
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const nt = this.notes[i];
            if (nt.end < t) {
                if (nt.end > 0) this.stop(nt);  // 手动停止则end<0但仍然留在notes中，不需要再次停止，直接删除
                this.notes.splice(i, 1);
            }
        }
    }
    stopAll() {
        for (let i = this.notes.length - 1; i >= 0; i--) {
            this.stop(this.notes[i]);
        } this.notes.length = 0;
    }
}