/**
 * 为密集计算设计的高性能非负最小二乘求解器
 */
class NNLSSolver {
    /**
     * @param {number} K 个数
     * @param {number} M 维度
     * @param {number} lambda 正则化参数 防止不稳定
     * @param {Float32Array|null} buffer_r 可选的外部残差缓冲区，长度应为M
     */
    constructor(K, M, lambda = 1e-4, buffer_r = null) {
        this.K = K;
        this.M = M;
        this.lambda = lambda;
        // 预分配内存
        this.c = new Float32Array(K);         // 最终系数 (K)
        this.s = new Float32Array(K);         // 候选系数 (K)
        this.w = new Float32Array(K);         // 梯度 (K)
        this.residual = buffer_r ?? new Float32Array(M);  // 增量残差 (M)
        this.matM = new Float32Array(M * M);  // 正规方程矩阵 (M*M)
        this.rhsM = new Float32Array(M);      // 正规方程右侧向量 (M)
        this.L = new Float32Array(M * M);     // Cholesky 分解矩阵 (M*M)
        this.z = new Float32Array(M);         // 临时连续解向量 (M)
        this.isP = new Uint8Array(K);         
        this.pIdx = new Int32Array(M);        
    }

    /**
     * 求解非负最小二乘问题 min ||Ax - b||_2^2 s.t. x >= 0
     * @param {Float32Array} A 每M个数为一组，一共K组
     * @param {Float32Array} b 长M
     * @returns {Float32Array} 长K的非负系数向量x 是this.c的引用
     */
    solve(A, b) {
        const { K, M, c, s, w, residual, isP, pIdx } = this;
        c.fill(0);
        isP.fill(0);
        residual.set(b); 
        let pCount = 0;
        const tol = 1e-7 * M; // 根据维度动态调整容差
        for (let iter = 0, maxIter = K << 1; iter < maxIter; iter++) {
            // 1. 计算梯度 w = A^T * residual
            let maxW = -1, jMax = -1;
            for (let j = 0; j < K; j++) {
                if (isP[j]) continue;
                let dot = 0;
                const offset = j * M;
                for (let i = 0; i < M; i++) dot += A[offset + i] * residual[i];
                w[j] = dot;
                if (dot > maxW) { maxW = dot; jMax = j; }
            }
            if (jMax === -1 || maxW < tol) break;
            isP[jMax] = 1;
            pIdx[pCount++] = jMax;
            while (pCount > 0) {
                // 求解子问题，结果暂存在 s 中
                if (!this._solveSubProblem(A, b, pCount, pIdx, s)) {
                    const last = pIdx[--pCount];
                    isP[last] = c[last] = 0;
                    break;
                }
                let alpha = 2.0;
                let hasConstraintViolation = false;
                for (let i = 0; i < pCount; i++) {
                    const idx = pIdx[i];
                    if (s[idx] <= 0) {
                        const ratio = c[idx] / (c[idx] - s[idx] + 1e-15);
                        if (ratio < alpha) { 
                            alpha = ratio; 
                            hasConstraintViolation = true;
                        }
                    }
                }
                if (!hasConstraintViolation) {
                    // 无冲突：更新残差并接受新系数
                    this._updateResidual(A, c, s, pCount, pIdx);
                    for (let i = 0; i < pCount; i++) c[pIdx[i]] = s[pIdx[i]];
                    break;
                }
                // 有冲突：按 alpha 步长靠近，并剔除归零的变量
                for (let i = 0; i < pCount; i++) {
                    const idx = pIdx[i];
                    c[idx] += alpha * (s[idx] - c[idx]);
                }
                for (let i = 0; i < pCount; i++) {
                    const idx = pIdx[i];
                    if (c[idx] < 1e-9) { // 稍微放宽归零判定
                        c[idx] = 0;
                        isP[idx] = 0;
                        pIdx[i] = pIdx[--pCount];
                        i--;
                    }
                }
                this._fullResidualUpdate(A, b, c, pCount, pIdx);
            }
        } return c;
    }

    _solveSubProblem(A, b, n, pIdx, s) {
        const { M, matM, rhsM, L, z, lambda } = this;
        // 1. 构建正规方程
        for (let i = 0; i < n; i++) {
            const offI = pIdx[i] * M;
            let dotB = 0;
            for (let r = 0; r < M; r++) dotB += A[offI + r] * b[r];
            rhsM[i] = dotB;
            for (let j = 0; j <= i; j++) {
                const offJ = pIdx[j] * M;
                let dotA = 0;
                for (let r = 0; r < M; r++) dotA += A[offI + r] * A[offJ + r];
                if (i === j) dotA += lambda;
                matM[i * n + j] = dotA;
            }
        }
        // 2. Cholesky 分解
        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = matM[i * n + j];
                for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
                if (i === j) {
                    if (sum <= 0) return false; 
                    L[i * n + j] = Math.sqrt(sum);
                } else {
                    L[i * n + j] = sum / L[j * n + j];
                }
            }
        }
        // 3. 前向替换 (L * y = rhsM -> 结果存入 z)
        for (let i = 0; i < n; i++) {
            let sum = rhsM[i];
            for (let k = 0; k < i; k++) sum -= L[i * n + k] * z[k];
            z[i] = sum / L[i * n + i];
        }
        // 4. 后向替换 (L^T * x = z -> 结果存入 z)
        for (let i = n - 1; i >= 0; i--) {
            let sum = z[i];
            for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * z[k];
            z[i] = sum / L[i * n + i];
        }
        // 5. 映射回原始大向量 s
        s.fill(0); // 必须清零，因为s共享
        for (let i = 0; i < n; i++) {
            s[pIdx[i]] = z[i];
        } return true;
    }
    _updateResidual(A, oldC, newS, n, pIdx) {
        const { M, residual } = this;
        for (let i = 0; i < n; i++) {
            const idx = pIdx[i];
            const delta = newS[idx] - oldC[idx];
            if (Math.abs(delta) < 1e-14) continue;
            const offset = idx * M;
            for (let r = 0; r < M; r++) residual[r] -= A[offset + r] * delta;
        }
    }
    _fullResidualUpdate(A, b, c, n, pIdx) {
        const { M, residual } = this;
        residual.set(b);
        for (let i = 0; i < n; i++) {
            const idx = pIdx[i];
            if (c[idx] === 0) continue;
            const offset = idx * M;
            for (let r = 0; r < M; r++) residual[r] -= A[offset + r] * c[idx];
        }
    }
    // 在调用 solve() 之后可以使用此函数获取当前残差的 L2 范数
    calcError() {
        let sum = 0;
        for (let i = 0; i < this.M; i++) sum += this.residual[i] ** 2;
        return Math.sqrt(sum);
    }
}
