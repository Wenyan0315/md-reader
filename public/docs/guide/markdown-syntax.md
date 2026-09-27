# Markdown 语法演示

本文展示阅读器对常见 Markdown 语法的渲染效果。

## 文本样式

支持 **加粗**、*斜体*、~~删除线~~、`行内代码`，以及 [外部链接](https://obsidian.md)（新标签页打开）。

## 代码块

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}

console.log(greet('MD Reader'));
```

```python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

## 表格

| 功能 | 支持情况 | 备注 |
| --- | --- | --- |
| 双向链接 | ✅ | Obsidian 风格 `[[链接]]` |
| GFM 表格 | ✅ | 横向滚动适配窄屏 |
| 任务列表 | ✅ | 见下方 |
| 目录跳转 | ✅ | 宽屏（xl）时显示 |

## 任务列表

- [x] 初始化项目
- [x] 支持文件夹读取
- [ ] 支持全文搜索
- [ ] 导出 PDF

## 引用与分隔线

> 好的工具应该让你忘记工具本身，专注于内容。
>
> —— 某位笔记软件开发者

---

## 嵌套列表

- 一级条目
  - 二级条目
    - 三级条目
- 另一个一级条目

1. 有序列表第一项
2. 第二项
   - 可以混用无序列表
3. 第三项
