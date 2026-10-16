# 精读任务与图表提取修复（0.2.61）

## 当前要求与实施顺序

1. 固定调研三个操作按钮的宽高、字体和间距，允许随窗口宽度换行；精读页头与工作区对齐。
2. 新建精读的范围选择使用有边界、限定高度、可键盘操作的主题菜单，显示文件夹所属路径。
3. 精读提供可见的删除入口，经过两次独立确认删除任务记录、追问、报告、图表及该任务工作区文件。论文库原始论文继续由论文库管理。
4. 修复图表提取编码，使用失败的实际 PDF 验证提取；运行前后端回归和桌面检查。
5. 生成 0.2.61 EXE 安装包并启动验证，提交 Git，推送 origin。

## 排查证据

- STALE 与 MemConflict 两项任务均为 failed，错误为 stream did not contain valid UTF-8。
- 两项工作区已生成图像和 paper.json，但 JSON 分别在偏移 1735、8780 处含 A1 AF 字节，即 Windows GBK 编码的弯引号。
- 随包 Java 为 17，调用时未设置文件编码；Rust fs::read_to_string 要求 UTF-8。
- 修复在 Java 启动时指定 -Dfile.encoding=UTF-8，输出与应用读取格式保持一致。
- 桌面与开始菜单快捷方式均指向 D:/PaperNest/paper-reader.exe，安装版本仍为 0.2.58。
- [OpenJDK JEP 400](https://openjdk.org/jeps/400) 说明 JDK 17 的默认字符集取决于环境，并支持通过 file.encoding 配置；[Carbon Dropdown](https://carbondesignsystem.com/components/dropdown/usage/) 用于范围选择的状态与菜单布局参考。

## 验证

- 两篇实际失败 PDF 分别执行图表提取集成测试：STALE 提取 14 个图表，MemConflict 提取 15 个图表；UTF-8 清单可读，生成的图片文件可访问。
- Rust 精读相关测试 25 项通过；实际 PDF 集成测试按两篇文件分别显式执行，均通过。
- 前端 60 个测试文件、230 项测试通过，TypeScript/Vite 构建通过；覆盖两次删除确认、两阶段取消、实际删除调用与文件夹层级选择。
- 1100 × 700 文件夹菜单完整位于窗口内，End 定位末项并自动滚动，Escape 关闭菜单并保留新建窗口。
- 两项原失败任务已在修复后的程序中重新排队，完整生成验证进行中。
