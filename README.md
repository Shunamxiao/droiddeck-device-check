# DroidDeck 设备检测

移动端网页：打开就能判断你的 Android 设备能不能跑 [DroidDeck](https://github.com/Droid-Deck/DroidDeck)（SteamOS on Android），可选跑一段分验证实测水平。

**在线版**：<https://shunamxiao.github.io/droiddeck-device-check/>

**这是第三方非官方工具**，与 DroidDeck 项目无隶属关系，不提供 APK 下载。安装包只从官方 GitHub Release 获取。

## 开发

```bash
npm install
npm run dev      # 本地开发，手机同网段访问 http://<电脑IP>:5173
npm run build    # tsc 类型检查 + vite 构建到 dist/
npm run test     # 判定逻辑回归测试（esbuild 打包后跑断言）
npm run smoke    # 真实 Chrome 的端到端冒烟（需先 build，复用本机 Chrome）
npm run perf     # 实测性能探针（FCP / 检测耗时 / 跑分稳定性）
npm run preview  # 预览构建产物
```

调试用 URL 参数（仅用于本地核对，不影响普通用户）：

- `?gpu=740` 强制按某个 Adreno 型号判定
- `?storage=64` 预填剩余存储

## 判定依据

结论不是拍脑袋，而是对齐 App 源码里的判定：

- `app/src/main/java/com/droiddeck/launcher/gpu/GpuInfo.kt` → `Family` / `support` / 解析正则
- `SocNames.kt` → SoC 型号与平台映射
- `app/src/main/res/values/strings.xml` → 存储、驱动、sysmem 等约束文案
- `docs/adreno-850-experimental.md` → Adreno 850 实验性支持
- `README.md` → 系统版本、子进程限制、存储占用

源码里的档位：`Adreno 8xx`、`650`、`7XX ≥ 725` 为已测试；`710/720/722/850` 与其余 6xx 为未测试；非 Adreno 不支持。

> 注意：README 写的是「Adreno 730 或更新」，而源码把 650、725 也标为已测试。本项目以源码为准，并在界面上提示这个差异。

## 设备与 GPU 词典

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `src/data/gpus.json` | 29 个 Adreno 型号（610–850）+ 家族 / 锚点 / 说明 | DroidDeck 源码判定 + 各 SoC 标称 FP32 峰值 |
| `src/data/socs.json` | 67 条骁龙 SoC → GPU 映射（含 8 Gen 1 到 8 Elite Gen 6、6/7 系列全档） | [Wikipedia: List of Qualcomm Snapdragon SoCs](https://en.wikipedia.org/wiki/List_of_Qualcomm_Snapdragon_systems_on_chips)（2026-10-28 抓取并解析） |
| `src/data/vendors.json` | 15 条非 Adreno 家族（Mali / Immortalis / Xclipse / PowerVR）+ 第三方档位与已知问题 | 社区实测表，`checkedAt` 标记数据时点 |
| `src/data/devices.json` | 91 款机型（掌机 / 手机 / 平板 / VR，含天玑与 Mali 对照） | 厂商规格与社区报告，抽样而非兼容性承诺 |

`anchor` 是把各 SoC 的 GPU FP32 峰值除以 Adreno 740 的 2089 GFLOPS 得到（A740 = 100），只用于跑分一致性判断，不参与档位判定；`SM6850/SM4450` 等没有公开峰值的型号取估算值并在 `note` 里标明。

数据一致性由 `npm run validate` 保证（已接入 `npm run build` 与 `npm run test`）：它会检查 GPU 型号唯一、每个 GPU 至少有一条 SoC、每个 SoC 指向存在的 GPU、机型声明的 SoC 与 GPU 必须一致、非 Adreno 机型的 `gpuLabel` 能匹配到 `vendors.json`、别名不冲突、ram 区间合法、JSON 不带 BOM。

## 双轨结论（非 Adreno）

官方 DroidDeck 只带 Adreno 的 Turnip，Mali / Xclipse / PowerVR 进不去 Steam，所以官方轨一律是 C。但第三方构建（直接跑手机自带的 GPU 驱动）已经在天玑等设备上跑起来，所以页面同时给出第二条轨：

| 第三方档位 | 含义 | 覆盖 |
| --- | --- | --- |
| B | 可玩 | Immortalis-G925（天玑 9400/9400+）、G720 MC12（9300/9300+）、G715（Tensor G3/G4）、G1/G2-Ultra |
| C | 仅轻量游戏 / 未验证 / 老驱动 | G720 MC7/MC8（8400/8500）、G710、G615、G610、G57、G68、G78、G77、G76、Xclipse |
| 无数据 | 没有公开实测 | PowerVR |

同名不同档按核心数区分（`Mali-G720 MC12` 与 `MC7` 结论不同）；渲染器没带 `MC` 时按高配假设并在文案里注明。本页只做判定，**不提供第三方构建的下载地址**。

## 浏览器能测到什么

| 信号 | 来源 | 可靠性 |
| --- | --- | --- |
| GPU 型号 | `WEBGL_debug_renderer_info` | 高，Adreno 设备通常直出 `Adreno (TM) xxx` |
| 机型 / 系统版本 | `userAgentData.getHighEntropyValues()`，UA 兜底 | 高（Chrome 110+ 的 UA 已被冻结成 `Android 10; K`，必须走高熵接口） |
| 内存 | `navigator.deviceMemory` + 机型库 | 中（浏览器上限 8 GB，只能判断 <8 或 ≥8） |
| 存储 | 用户手动输入 | 高（浏览器拿不到剩余空间，`storage.estimate()` 给的是配额不是可用量） |
| 子进程限制开关 | 用户手动确认 | 高 |
| Vulkan 版本 / 驱动 | 无法获取 | — |

## 跑分

- GPU：WebGL2 的 ALU 填充、混合填充（overdraw）、实例化几何
- CPU：整数 / 浮点 / 内存带宽（x86 游戏走 FEX 翻译，单核性能经常先见底）
- 输出综合性能指数（基准 100 ≈ Adreno 740 档掌机）与「同型号一致度」

稳定性做法：每个子项先预热，再固定时间窗（200 ms）反复绘制并用 `readPixels` 强制 GPU 同步，取 3 次中最好的成绩；CPU 各项预热后取 2 次中较快的耗时。实测三次连续跑分离散度从 78% 降到 1–8%。

基线目前是估算值（`src/data/refs.json` 里 `calibrated: false`）：由桌面参考机（GTX 1650 级）实测值除以 3 的掌机/桌面倍率推得，**未校准前分数不参与降档**。真机采样后校准：

```bash
node scripts/calibrate.mjs samples.json --gpu 740
```

`samples.json` 形如：

```json
[{ "gpu": 740, "aluFill": 3210, "overdraw": 4050, "geometry": 2980, "cpuInt": 431, "cpuFloat": 62, "cpuMem": 9.8 }]
```

## 目录

```
src/core/      判定引擎（adreno 分类、verdict 结论）
src/detect/    GPU / WebGPU / 机型 / 环境探测
src/bench/     WebGL2 与 CPU 跑分、打分
src/data/      GPU、SoC、机型、规则、基线数据
src/ui/        单页应用与状态机
scripts/       校准与逻辑测试
```

## 已知限制

- 浏览器看到的是 Android 原生 GPU，不代表 Proton / FEX 下的真实帧率，也不覆盖驱动兼容性。
- 内存建议值（≥12 GB 舒适、8 GB 吃紧、6 GB 以下不建议）是社区经验推定，官方未定义下限。
- 部分浏览器会遮蔽渲染器字符串，此时请手动选择机型。
- 机型库是常见机型抽样，不构成兼容性承诺；判定单位始终是 GPU 家族。
