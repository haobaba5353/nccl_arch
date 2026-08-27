# NCCL 全部算子图谱

交互式静态网页，以 4 个代表性 rank 和 4 个向量位置展示 NCCL 算子的缓冲区变化与传输轨迹。

## 查看页面

直接在浏览器中打开 `docs/nccl-architecture-operators.html`。

## 资源结构

```text
docs/
  nccl-architecture-operators.html
  plugins/handdrawn-blueprint/
    handdrawn-blueprint.css
    flow-diagram-interactions.js
```

HTML 使用相对路径加载样式和交互脚本，因此应保留上述目录结构。

## GitHub Pages

在仓库的 `Settings` -> `Pages` 中选择从 `main` 分支的 `/docs` 目录发布。

发布后页面地址：

```text
https://haobaba5353.github.io/nccl_arch/nccl-architecture-operators.html
