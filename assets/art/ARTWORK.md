# 纸剧场插画

使用内置图像生成与图像编辑，绘制完整修正版、背景补全层和独立纸片。SVG 只负责裁切、遮挡和定位，物件与牌背均使用绘制的位图。梨、帷幕和书签在互动时整片平移，不拉伸或变形。

## 资源

- `paper-theatre.png`，完整修正版。1672 × 941。
- `paper-theatre-clean.png`，移动物件背后的补全画面，1672 × 941。小剧场内的旧系带帘也已移除。
- `paper-props.png`，1673 × 940 透明底纸片。包括完整梨、闭合的左右纸帘、留有隐藏上端的完整书签。
- `tarot-back.png`，1086 × 1448 手绘牌背。花枝、纸剧场、月亮与飞蛾用于首页牌盒和抽牌页。
- `city-lit.png`，1672 × 941 暖黄色亮灯画面。网页只叠加城市区域，不叠加其他物件。
- `generation-prompts.json`，本次新增和修订资源使用的完整提示。

## 纸片动作与遮挡

- 梨沿垂直方向移动 26 个画面坐标单位，完整底部始终由固定篮沿和篮身遮挡。
- 两片帷幕在静止时合拢，分别向左右移动 76 个画面坐标单位。木框与上方横帘固定，舞台开口固定。
- 书签是连续的长纸片，隐藏上端也随可见部分一起移动。固定的书页缝隙遮住上端，移动量为向左 4、向下 14。
- 灯光使用重新绘制的亮灯版本，包含暖黄色窗芯、琥珀色边缘和窗沿反光。
- 鸽子及信封继续使用原有轮廓、绳线和实际下拉逻辑。

## 完整画面编辑提示

```text
Use case: precise-object-edit.
Asset type: full-screen artwork for an interactive paper theatre website, no interface text.
Input 1 is the EDIT TARGET: the complete existing quiet pink-purple paper-theatre scene. Input 2 is ONLY an annotation guide: green rectangles indicate structures to repair, never reproduce green marks.
Create a corrected version of Input 1. Preserve its composition, framing, object positions, delicate aged-paper texture, muted dusty rose / lavender / sage / blue-grey palette, soft even light, 16:9 canvas and calm handcrafted illustration. Keep all six entrance objects in the SAME places. Do not redesign the whole scene or turn it dark.
Precise corrections:
1. The huge flower at left: coherent flower anatomy, every petal joins the same central receptacle, fine stamens emerge naturally there, one attached stem. Repair the confusing folded/melted lower petal construction while retaining a beautiful open papery flower.
2. The little distant bridge near centre-right: redraw it as a continuous credible SMALL TWO-ARCH STONE BRIDGE/VIADUCT. A thin consistent deck rests on two continuous arches and grounded piers, ends join the hills. No floating lintel, broken columns or unattached scalloped top.
3. The foreground floral rectangular card box: geometrically consistent closed removable lid and rectangular base. Lid top, lid lip, side walls and corners share one perspective; lid fits the box with a small even overhang, a clean continuous seam. Paper floral pattern conforms to each flat plane. Keep the front corner and original footprint essentially unchanged, no extra objects.
4. The pear on the floor beside basket: recognizable natural pear with a single short stem from its TOP indentation, coherent tapered neck and rounded base, resting with contact shadow. Remove the strange twig/leaf connection from its bottom. A separate fallen leaf may remain on the floor.
5. Keep the origami pigeon and its envelope, a thin thread attached visibly to its upper back, and a believable small grip at the envelope corner. The thread ends at the overhead theatre structure.
6. Keep the basket and its woven handle physically coherent, the front green pear clearly separate inside it. Keep the closed violet book and its single rose ribbon bookmark emerging between the pages at the bottom edge. Keep the central small stage framed by wood and its curtains closed.
Preserve the entire original scene and subtle paper-cut layering outside these repairs. Same scale and placement, no new characters, no writing, no typography, no labels, no green lines, no borders added, no glow. Render polished cohesive original artwork, not a web mockup. Prefer landscape 2048x1152 while preserving the existing composition exactly.
```

## 初版补全层编辑记录

以下为初版记录。当前版本在该画面上继续移除了旧系带帘，替换为独立的左右纸片。最新编辑提示保存在 `generation-prompts.json`。

```text
Use case: precise-object-edit.
Asset type: clean background plate for a paper-theatre website with animated cutout actors.
Input image 1 is the EDIT TARGET, the already corrected full illustration. Keep EXACT same canvas 1672 by 941, all coordinates, perspective, papery aged texture, dusty rose / sage / lavender / blue-gray colors and soft lighting. This must pixel-align with the input so extracted moving objects can be layered back on top. Make only the following localized removals/inpainting, do not rearrange or redesign the scene.

1. Remove the complete paper pigeon, envelope, and thin overhead hanging thread, at approx x675..946 y82..336. Reconstruct the same unobtrusive blue-gray cloudy paper background behind them, seamless with surrounding background.
2. Remove ONLY the front green pear and its stem inside the left basket at approx x154..250 y563..666. Keep the basket weave, rim, handle, cloth, the yellow pear and the red fruits completely unchanged. Reveal a little dark basket interior/otherfruit behind the removed green pear. The separate pear on the floor remains unchanged.
3. The small wooden theatre at approx x380..649 y325..660: REMOVE only the central dark rear drop-curtain visible between the two tied dusty-pink side curtains. Keep the wooden arched frame, top scalloped valance, both tied side curtains and their gold ties unchanged. Behind the removed central drop-curtain reveal a quiet recessed miniature empty lavender paper stage, simple worn muted backdrop and flat stage floor with no objects, no text. Precise existing opening and all borders unchanged.
4. Remove ONLY the removable floral lid of the foreground rectangular box, approx x503..818 y638..760. Keep both floral box body walls and their corners at x508..814 y711..840 exactly unchanged. Reveal the box's top opening with a believable narrow cardboard rim and dark muted maroon interior, same perspective. Do not add cards; they will be an animated overlay.
5. Remove ONLY the hanging rose bookmark ribbon at approx x1185..1238 y622..678. Keep the violet book, gold floral cover, pages, binding and steps exactly unchanged. Reconstruct the small portions of book bottom edge and stone step behind the ribbon naturally.
6. Remove the one loose rose petal on the foreground floor at approx x1005..1119 y779..827, reconstruct same floor texture.

Everything else must remain unchanged including the corrected big left flower, solid two-arch bridge, static floor pear, buildings and dark windows, flowers, winding stairs, edge curtains, floor, vignette. Do not change outlines or add shadows outside localized edits. No words, UI, labels, borders, greenscreen, glow, new furniture or characters. The intended visible gaps are for real moving actors, not an overall new composition.
```
