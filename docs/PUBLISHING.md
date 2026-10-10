# 发布指南

## 建议顺序

先使用 GitHub 维护源码、收集兼容性反馈并提供 Release 下载，再通过 Chrome Web Store 面向普通用户分发。两者可以并行维护同一套源码。

项目仓库：<https://github.com/felixwong1989/x-follower-count>。最新版本为 `v1.0.3`，运行 ZIP 在对应 Release 中提供。

## 上传到 GitHub

1. 在 GitHub 创建名为 `x-follower-count` 的空仓库，并选择公开或私有。
2. 在项目根目录执行下面命令。将 `YOUR_ACCOUNT` 替换为你的账号。

```sh
git init -b main
git add .
git commit -m "Initial X follower count extension v1.0.3"
git remote add origin https://github.com/YOUR_ACCOUNT/x-follower-count.git
git push -u origin main
```

3. 使用 `python scripts/package.py` 生成运行包。
4. 创建 `v1.0.3` Release，附上运行 ZIP 和 CHANGELOG 中的版本说明。

参考：[创建仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)、[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。

## 许可证

如果希望用户能自由修改、分发和商用，可以评估 MIT 许可证，并填写你的版权署名后加入根目录 `LICENSE`。项目尚未配置许可证，由发布者决定授权方式。

参考：[GitHub 许可证说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。

## Chrome Web Store 尚缺的材料

- 开发者账号、一次性注册费和两步验证。
- 128×128 PNG 图标，并在 manifest 中配置 `icons`。
- 440×280 宣传图。
- 至少一张 1280×800 或 640×400 的实际功能截图。
- 商店描述、用途说明、权限/数据处理申报、可公开访问的正式隐私政策 URL。
- 真实登录态下的自动抓取确认，以及安装、更新和主要页面路线的生产验证。

当前脚本生成的运行 ZIP 根目录结构符合上传形式；提交商店前还要补充图标文件和打包白名单。通过商店审核后才能上架。

官方说明：[注册](https://developer.chrome.com/docs/webstore/register/)、[准备扩展](https://developer.chrome.com/docs/webstore/prepare)、[图片要求](https://developer.chrome.com/docs/webstore/images)、[隐私政策](https://developer.chrome.com/docs/webstore/program-policies/policies)、[提交发布](https://developer.chrome.com/docs/webstore/publish)。
