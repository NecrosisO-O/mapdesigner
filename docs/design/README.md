# 设计资料

| 资料 | 用途 |
| --- | --- |
| [editor-v3 视觉与水系规范](./editor-v3/README.md) | 正式编辑器的布局、材料、地图样式、河流连接和输出约定 |
| [固定制图场景](./editor-v3/fixtures/cartography-gallery.json) | 浏览器视觉验收与回归使用的场景数据 |
| [星湾地图](./editor-v3/fixtures/visual-estuary.json) | 工作区、地形与河口共同样例 |
| [河流宽度兼容契约](../RIVER_WIDTH_COMPATIBILITY.md) | 旧宽度规则、距离插值与历史恢复 |
| [editor-v2 历史交互原型](./editor-v2/README.md) | 2026-10-02 的独立 HTML/CSS/JavaScript 原型与截图 |

`editor-v3/fixtures/` 被当前开发验收页面和测试引用，属于可执行样例。调整场景后核对浏览器与导出，并记录样式、视口和输出选项。重生成工具会改写固定样例与图集，详见[维护脚本](../../scripts/README.md)。

界面和河流的完整改造过程见[视觉重构档案](../archive/plans/2026-10-03-visual-redesign.md)；截图、逐项证据与未完成的人工验收见[研究索引](../research/README.md)。
