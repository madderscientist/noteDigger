/**
 * 谱聚类算法
 * @param {Array<Float32Array>} feats
 * @param {number} numClusters 
 */
function SpectralClustering(feats, numClusters, affinityFunc) {
    // 1. 计算修改后的归一化拉普拉斯矩阵 Lsym = I + D^(-1/2) * W * D^(-1/2)
    const L = TriangleMatrix.Lsym(feats, affinityFunc);
    // 2. 使用正交迭代法计算前k个特征向量
    const U = TriangleMatrix.orthogonalIteration(L, numClusters);
    // console.log(U);
    // 3. 转置并归一化
    const { flatMatrix, n, k } = transposeAndNormalize(U);
    // 4. 基于 Pivoted QR 选择聚类中心
    return clusterQR(flatMatrix, n, k);
}

/**
 * 转置并归一化 (Transpose & Normalize)
 * 优化点:
 * 1. 预计算范数：利用原始数据的内存布局（顺序读取）计算模长；乘法代替除法：预先计算 1/norm
 * 2. 分块写入 (Tiling)：将转置过程分块，确保写入 `flat` 数组时命中缓存
 * 3. 减少重复计算：提前解构引用，避免在循环内多次查找 `eigenVectors[r]`
 * 4. 手动维护索引，消除循环内的乘法运算
 * @param {Array<Float32Array>} eigenVectors 大小为 k 的数组，每个元素长 n
 * @param {number} BLOCK_SIZE L1 缓存分块大小
 * @returns {{flatMatrix: Float32Array, n: number, k: number}}
 */
function transposeAndNormalize(eigenVectors, BLOCK_SIZE = 1024) {
    const k = eigenVectors.length;
    const n = eigenVectors[0].length;
    const flat = new Float32Array(n * k);

    // normSq[i] 存储第 i 个数据点（即第 i 行）的模长平方
    const normSq = new Float32Array(n);

    // 1. 预计算模长 (保持不变，因为这是最高效的)
    for (let r = 0; r < k; r++) {
        const vec = eigenVectors[r];
        for (let i = 0; i < n; i++) {
            normSq[i] += vec[i] * vec[i];
        }
    }
    // 归一化系数
    for (let i = 0; i < n; i++) normSq[i] = 1.0 / Math.sqrt(normSq[i] + 1e-10);

    // 2. 分块转置
    // 由于 k 很小，一行的数据量很小 (20 bytes)。
    // 我们可以适当增大 BLOCK_SIZE，比如 1024 或 2048

    // 提前解构引用，避免在循环里查找 eigenVectors[r]
    const vecs = Array.from({ length: k }, (_, i) => eigenVectors[i]);

    for (let iBase = 0; iBase < n; iBase += BLOCK_SIZE) {
        // 确定当前块的边界
        const iLimit = (iBase + BLOCK_SIZE < n) ? (iBase + BLOCK_SIZE) : n;

        for (let r = 0; r < k; r++) {
            const vec = vecs[r];
            // 手动维护索引，消除循环内的 (i * k) 乘法
            // 初始索引：当前块起始行(iBase) * k + 当前列(r)
            let flatIndex = iBase * k + r;
            for (let i = iBase; i < iLimit; i++) {
                // 直接使用指针
                flat[flatIndex] = vec[i] * normSq[i];
                // 步进为 k，因为 flat 是行优先存储，
                // 同一列的下一个元素在 flat 中相隔 k 个位置
                flatIndex += k;
            }
        }
    }
    return { flatMatrix: flat, n, k };
}


/**
 * 完整的 Cluster QR 聚类
 * 包含：中心点选择 + 标签分配
 * 
 * @param {Float32Array} flatMatrix (n * k) 归一化后的特征矩阵 (只读)
 * @param {number} n 点的数量
 * @param {number} k 聚类数量
 * @returns {Int32Array} 长度为 n 的数组，labels[i] 表示第 i 个点属于第几类 (0 到 k-1)
 */
function clusterQR(flatMatrix, n, k) {
    // --- 阶段 1: 准备工作 ---
    
    // 1. 必须复制一份数据用于 QR 分解的残差计算
    // 因为 MGS 算法会破坏性地修改数据，而我们最后分配时需要原始数据
    // 这里的内存开销是必要的 (n * k * 4 bytes)
    const residualsMatrix = flatMatrix.slice(); 
    
    const centroidIndices = new Int32Array(k);
    const residualNorms = new Float32Array(n);
    
    // 初始化残差模长 (由于输入已归一化，初始全为 1.0)
    // 但为了保险，还是算一下，或者直接 fill(1.0) 如果上一步很自信
    residualNorms.fill(1.0); 

    const currentPivot = new Float32Array(k);

    // --- 阶段 2: 选择中心点 (Pivot Selection) ---
    for (let step = 0; step < k; step++) {
        // 2.1 寻找残差最大的点
        let maxNorm = -1.0;
        let pivotIdx = -1;
        
        for (let i = 0; i < n; i++) {
            if (residualNorms[i] > maxNorm) {
                maxNorm = residualNorms[i];
                pivotIdx = i;
            }
        }
        
        // 记录中心点索引
        centroidIndices[step] = pivotIdx;
        
        if (maxNorm < 1e-6) break; // 剩余点都几乎为0了

        // 2.2 提取 pivot 向量 (从残差矩阵中提取)
        const pivotOffset = pivotIdx * k;
        const pivotScale = 1.0 / Math.sqrt(maxNorm);
        
        for (let j = 0; j < k; j++) {
            currentPivot[j] = residualsMatrix[pivotOffset + j] * pivotScale;
        }

        // 2.3 正交化 (更新残差矩阵)
        for (let i = 0; i < n; i++) {
            if (residualNorms[i] < 0) continue; // 已选过的跳过
            if (i === pivotIdx) {
                residualNorms[i] = -1.0; 
                continue;
            }

            const offset = i * k;
            
            // dot = <residual_i, pivot>
            let dot = 0.0;
            for (let j = 0; j < k; j++) {
                dot += residualsMatrix[offset + j] * currentPivot[j];
            }

            // residual_i = residual_i - dot * pivot
            let newNorm = 0.0;
            for (let j = 0; j < k; j++) {
                const val = residualsMatrix[offset + j] - dot * currentPivot[j];
                residualsMatrix[offset + j] = val;
                newNorm += val * val;
            }
            residualNorms[i] = newNorm;
        }
    }

    // --- 阶段 3: 分配标签 (Label Assignment) ---
    // 既然数据已经归一化，欧氏距离最近等价于余弦相似度最大 (Dot Product Largest)
    
    const labels = new Int32Array(n);
    
    // 为了极致性能，先将 k 个中心点的原始向量提取到连续内存中
    // 这样在遍历 n 个点时，中心点数据能更好地待在 Cache 里
    const centerVectors = new Float32Array(k * k);
    for (let c = 0; c < k; c++) {
        const centerIdx = centroidIndices[c];
        const srcOffset = centerIdx * k;
        const destOffset = c * k;
        for(let j=0; j<k; j++) {
            centerVectors[destOffset + j] = flatMatrix[srcOffset + j];
        }
    }

    // 对每个点进行分类
    for (let i = 0; i < n; i++) {
        let maxSim = -Infinity;
        let bestCluster = 0;
        
        const pointOffset = i * k;
        
        // 遍历所有中心点，找最相似的
        for (let c = 0; c < k; c++) {
            const centerOffset = c * k;
            
            // 计算点积 (Dot Product)
            let dot = 0.0;
            for (let j = 0; j < k; j++) {
                dot += flatMatrix[pointOffset + j] * centerVectors[centerOffset + j];
            }
            
            if (dot > maxSim) {
                maxSim = dot;
                bestCluster = c;
            }
        }
        labels[i] = bestCluster;
    }

    return labels;
}


class TriangleMatrix {
    constructor(size) {
        this.size = size;
        this.data = new Float32Array((size * (size + 1)) / 2);
    }

    // 发现效果比exp(cos-1)好
    static cosineAffinityExp(featureA, featureB) {
        let dot = 0;
        for (let i = 0; i < featureA.length; i++) {
            dot += featureA[i] * featureB[i];
        }
        return Math.exp(dot);
    }

    /**
     * 直接计算归一化拉普拉斯矩阵
     * 但是正交迭代法求的是绝对值最大特征值对应的特征向量，而需要的是最小特征值对应的特征向量
     * 因此将本来的"I-"换成了"I+"，此时特征向量不变，特征值变为原来的2-λ
     * @param {Array<Float32Array>} features 
     * @param {Function(Float32Array, Float32Array): number} func W(i, j) = func(features[i], features[j])
     * @returns {TriangleMatrix} D^(-1/2) * W * D^(-1/2) + I
     */
    static Lsym(features, func = TriangleMatrix.cosineAffinityExp) {
        const size = features.length;
        const affine = new TriangleMatrix(size);
        const rowSums = new Float32Array(size);
        const data = affine.data;
        // 不算自环，直接跳过第一个
        for (let j = 1, idx = 1; j < size; j++, idx++) {    // col
            const colFeature = features[j];
            for (let i = 0; i < j; i++, idx++) {            // row
                const affi = func(colFeature, features[i]);
                data[idx] = affi;
                rowSums[i] += affi;
                rowSums[j] += affi;
            }
        }
        // 此时对角线元素均为0
        // 归一化
        for (let j = 0, idx = 0; j < size; j++, idx++) {
            for (let i = 0; i < j; i++, idx++) {    // 本应是i <= j，但是对角线元素单独处理，所以将最后一个idx++放在外层
                const div = Math.sqrt(rowSums[i] * rowSums[j]);
                if (div > 1e-10) data[idx] = data[idx] / div;
                else data[idx] = 0;
            }
            // 对角线元素设为1
            data[idx] = 1;
        }
        return affine;
    }

    _index(i, j) {
        // 内联优化建议：在热路径中尽量手动计算，减少函数调用开销
        if (i > j) return (i * (i + 1)) / 2 + j;
        return (j * (j + 1)) / 2 + i;
    }

    /**
     * 优化的矩阵乘法 Z = A * Q
     * @param {Array<Float32Array>} Q_in 输入向量组 (k个)
     * @param {Array<Float32Array>} Z_out 输出向量组 (k个，预分配好)
     */
    mult_mat_optimized(Q_in, Z_out) {
        const size = this.size;
        const k = Q_in.length;
        const data = this.data;

        // 清空输出 buffer
        for (let r = 0; r < k; r++) Z_out[r].fill(0);

        for (let j = 0, idx = 0; j < size; j++) {
            for (let i = 0; i <= j; i++, idx++) {
                const val = data[idx];
                for (let r = 0; r < k; r++) {
                    const vecIn = Q_in[r];
                    const vecOut = Z_out[r];
                    vecOut[i] += val * vecIn[j];
                    if (i !== j) vecOut[j] += val * vecIn[i];
                }
            }
        }
    }

    /**
     * 正交迭代法 求前k个绝对值最大的特征值对应的特征向量
     * @param {TriangleMatrix} A 建议是 I + D^{-0.5}WD^{-0.5}
     * @param {number} numVectors 需要的特征向量数量
     * @param {number} numIterations 迭代次数
     * @return {Array<Float32Array>} 特征向量矩阵 size * numVectors
     */
    static orthogonalIteration(A, numVectors, numIterations = 30) {
        const size = A.size;

        // 双缓冲
        let Q = Array.from({ length: numVectors }, () => new Float32Array(size));
        let Z = Array.from({ length: numVectors }, () => new Float32Array(size));

        // 初始化 Q 为随机并正交化
        for (let r = 0; r < numVectors; r++) {
            for (let i = 0; i < size; i++) Q[r][i] = Math.random();
        }
        SchmidtInPlace(Q); // 原地正交化

        // 迭代
        for (let iter = 0; iter < numIterations; iter++) {
            // Z = A * Q (写入 Z buffer)
            A.mult_mat_optimized(Q, Z);
            // Q = Schmidt(Z) (原地正交化 Z，结果仍在 Z buffer 中)
            SchmidtInPlace(Z);
            // 交换 buffer：Z 变成了下一次的 Q，原来的 Q 变成下一次的废弃 buffer (Z)
            const temp = Q; Q = Z; Z = temp;
        }
        return Q;
    }
}

/**
 * 施密特正交化 (原地修改版 / In-Place MGS)
 * 没有任何内存分配，速度极快
 * @param {Array<Float32Array>} V 向量组
 */
function SchmidtInPlace(V) {
    const k = V.length;
    const n = V[0].length;

    for (let i = 0; i < k; i++) {
        const qi = V[i];

        // 归一化当前向量
        let dot = 0.0;
        for (let x = 0; x < n; x++) dot += qi[x] * qi[x];
        const norm = Math.sqrt(dot);
        const scale = norm < 1e-10 ? 0 : 1.0 / norm;
        for (let x = 0; x < n; x++) qi[x] *= scale;

        // 正交化后续向量 (MGS)
        for (let j = i + 1; j < k; j++) {
            const vj = V[j];

            // 计算投影 proj = <vj, qi>
            let proj = 0.0;
            for (let x = 0; x < n; x++) proj += vj[x] * qi[x];

            // 减去投影 vj = vj - proj * qi
            for (let x = 0; x < n; x++) vj[x] -= proj * qi[x];
        }
    }
}