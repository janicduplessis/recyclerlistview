# @irisjae/recyclerlistview

## How to use

This patch to RecyclerListView primarily adds the `preserveVisiblePosition` prop to RecyclerListView. This prop keeps the visible region of the list fixed regardless of changes in the height of items around the region and adding new data to the list.

`@irisjae/recyclerlistview` should be compatible with `recyclerlistview`, and one should be able to simply swap it out with this instead. Lists without the `preserveVisiblePosition` prop passed should almost always behave identically to `recyclerlistview`.

It is recommended to use this library via `@irisjae/flash-list` if possible.

### Cavaets

`preserveVisiblePosition` is only implemented for React Native (no web support), and for vertical lists of a single column.

## Motivation

For a long time, list rendering has been a sore point of React Native. Months of my life have been spent fixing lists. React Native's built-in solutions to lists, the ScrollView and FlatList, have settings that are not very well suited to rendering large lists without a lot of tuning and work.

[To render large lists effectively, virtualisation and recycling of list items is crucial. Many attempts at providing this functionality for React Native effectively have come up over the years. RecyclerListView/FlashList provide one of the best solutions for achieving virtualisation and recycling in React Native today.](https://margelo.notion.site/WishList-Summit-b20c24d1f0da4889a0513dfa929be5ed)

However, RecyclerListView/FlashList does not work well when moving into a region with many items of unknown height around the visible content, or when the list changes (e.g. new items added to the beginning of the list). When this occurs, scrolling becomes incredibly choppy, appearing to the user as if the list content is jumping around as the user scrolls. This patch solves this problem.

This problem has plauged RecyclerListView/FlashList for a long time, occuring variously when the user scrolls very quickly, or when the user jumps through the list using `initialRenderIndex` or with scroll methods like `scrollToIndex`. This problem also manifests as scroll methods scrolling to the 'wrong' position. Some relevant issues include the following:
- https://github.com/Shopify/flash-list/issues/547
- https://github.com/Shopify/flash-list/issues/582
- https://github.com/Flipkart/recyclerlistview/issues/241
- https://github.com/Flipkart/recyclerlistview/issues/195

Inspired by [attempts](https://github.com/Shopify/flash-list/pull/824) to solve this, I realised that the root of the issue lay at the layout algorithm of RecyclerListView, thus this attempts to solve it from the root.

## Mechanism

### Background

To decide which list items to show when a user scrolls to a position, RecyclerListView keeps an internal list of layouts, and performs a 'relayout' whenever necessary e.g. sizes of items change. Ideally, the sizes of all items are known in advance, and the user can provide this information to RecyclerListView via the `layoutProvider` prop. In this case, none of the mentioned problems (choppy scrolling, inaccurate scrollTo targets) occur. However, this is oftens not possible.

RecyclerListView also provides a 'non-deterministic' rendering mode with the `forceNonDeterministicRendering` and `layoutSize` props. In this mode, RecyclerListView assumes the sizes of items to be `layoutSize`. When RecyclerListView actually renders the items, it finds out the actual size of the item, updates the internally stored item height, and relayouts the list. This works quite well when the estimates are typically close to the actual list item size.

When laying out positions of list items, conceptually, RecyclerListView starts from '0' at the beginning of the list, and keeps adding up the total heights of the list items before each next item to determine its position. However, this implies that when the item heights of elements before the visible position are inaccurate and have to be updated, the positions of every item after the inaccurate estimatation changes. Layout positions are always calculated relative to the start of the list. This causes all the mentioned issues.

(Thus solutions that do not fix layouting e.g. only fix positions of rendered content, cannot fix this issue; disagreements between the layouting and the rendered position, which may accumulate, when sufficiently serious, cause the rendered items to not even include items which should be included.)

### Sketch

This patch solves this problem by:
- Relative layouting
  - Whenever possible, always assume that the visible window of content is already in the right position and shift everything relative to the *visible position* rather than the start of the list. 
- 'Refixing'
  - Shifting the rest of the list in this way means that list items at the edges may not coincide with the edges of the ScrollView. Whenever opportune, or whenever the user approaches list edges, we shift the ScrollView scroll offset and every list item together to realign the items.
 
### Details

#### Rendered layout detection

The default RecyclerListView layouting algorithm only makes use of list item heights during its calculation. Correspondingly, RecyclerListView only makes use of already rendered items by obtaining their heights via `onLayout`. Once the actual rendered height of an item is obtained, the layout is marked as 'overridden', and trusted by the algorithm moving forwards.

This has drawbacks when:
- `onLayout` events are asynchronous and may arrive at RecyclerListView at different times. This would cause multiple relayouts, with layout jumps in between.
- Due to various issues e.g. accumulated rounding errors, using just the rendered heights to perform calculation of positions in layouting may result in incorrect positions.

This may the best we can do if we stick to using plain Views for rendering the list items. However, RecyclerListView offers for users to provide their own ScrollComponent, which is used by FlashList to perform the same layouting with actual rendered values on the native side which has access to more information. We allow for ScrollComponents to further implement a `onAutoLayout` event to report all its layouting information to RecyclerListView, subsuming the functions of `onLayout` such that:
- Layouting information of all items are reported together, so more accurate and coherent information is obtained
- We may collect actual rendered item positions to directly use, rather than rederiving the values by relayouting.

This `onAutoLayout` is implemented by `@irisjae/flash-list`, along with native implementations of the relative layout algorithm. If provided ScrollComponents support this event, please specify the `nonDeterministicMode="autolayout"` prop to use `onAutoLayout` in favour of `onLayout`.

In cases like refixing, we may have shifted absolute positions of items so that previously reported heights of layouts are still valid, but absolute positions are no longer valid. In other cases, such as list changes, previously reported list heights and positions for any given index may no longer be valid. This is kept track of with `_autoLayoutId` and `_baseAutoLayoutId`.

#### Relative layouting
We pick a single index (`_fixIndex`) close to the visible window with respect to which we do all layouting.

Fixing indexes aims to avoid visible layout shifts.  To achieve this, when we select an index to fix, we aim to 1) move the fix index as little as possible, 2) prefer overriden indexes, and 3) prefer visible indexes.
1) is because users do not expect previously viewed content to shift, wheras some degree of shifting for new content is understandable
2) is because indexes which have already been overriden have known layouts, and should be more accurate. Furthermore, when overrides come from `nonDeterministicMode="autolayout"`, overriden layouts are the rendered values, and fixing to them ensures that we do not cause rendered items to shift.
3) is because visible content shifts occur when the total height of items between the fixed position and the rendered item changes. With `_fixIndex` close to other visible items, we minimise the number of items between the fixed position and visible content, so that we minimise the number of items that can cause total height changes.
When the above considerations cannot be met, we prefer to leave `_fixIndex` unchanged until they can be, as long as the previous _fixIndex is still admissable.

Good selection of `_fixIndex` is crucial to ensuring the continuity of content already visible to the user. 

#### 'Refixing'

When a user is far from list edges, it should make no difference to him whether the first and last list items coincide with the physical start and end of the list. Only when the edge items or the physical edge is visible does any artifact become visible to the user. We attempt to refix as soon as possible, such that this will not happen.

This patch waits until no scrolling is in progress, then attempts to perform refixing.

If the user scrolls very quickly and reaches list edges before refix happens, we immediately refix. In this case either the list is too short, or the list is too long. As part of the refix, `scrollTo` of the ScrollView is called, causing the scrollbars to flash, which is similar to common UI affordances that indicate new content being loaded, thus is an acceptable experience. 

#### List changes

The relative layouting mechanism allows us to easily maintain the visible content regardless of list changes (unless the content within the visible window is too, changed, of course). When list data provided to RecyclerListView changes, we search the new list for the new index with the same stableId as `_fixIndex`, and simply set the position of the new `_fixIndex` to the position of the old `_fixIndex`, and replace the `_fixIndex`, so that subsequent relayouting remain relative to the same stableId.

Another problem that occurs with list changes is that RecyclerListView associates layouts to list indexes, rather than stableIds. This is a big problem when e.g. we have a situation like `short item - very long item - short item - very long item`. Once the list is rendered, the layouts of all four items are overridden. If an item is now added to the beginning of the list, the indexes of layouts are shifted by one, and suddenly, the overridden layouts of all four items become completely inaccurate. This causes visible jumps.

This patch provides the `shiftPreservedLayouts` prop to solve this problem when list changes mostly consist of appends or deletions (not e.g. shuffling). Since we are able to determine the old and new `_fixIndex`es on list changes, we know the amount of indexes shifted during a data change. Setting `shiftPreservedLayouts` (the default) will make all layouts shift by the same number of indexes as the `_fixIndex` does, so that layouts remain unshifted relative to the visible position (the `_fixIndex`).

When one is near the start of the list, one often wishes the list to always stay at the beginning of the list. This is the default behaviour. This can be switched off by the prop `startEdgePreserved={true}` to stick to the visible content rather than the list start even near the list start. The threshold for being 'near' the list start can be adjusted with the prop `edgeVisibleThreshold`.

#### Scroll methods

Without this patch, when scrollTo methods are invoked towards regions where layouts are inaccurate, as the scroll proceeds and the inaccurate estimates are overridden, altering layouts, yet, the target scroll offset remains unchanged, causing inaccuracies. Furthermore the programmatic scrollTo may be very fast, and not all layouts before the target position may be obtained, causing choppiness when the user proceeds to scroll up, revealing the bad layouts in between.

The latter problem is solved by relative layouting.

The former problem is solved by simply assigning `_fixIndex` to the target item of scrollTo, so that we ensure that it is not shifted away by layouting, and remains precisely where we expect it to be.

## Remarks

Hopefully @naqvitalha finds a way to make this mechanism into RecyclerListView/FlashList core, so that I can deprecate this!

Note that apparently the lint scripts use tslint, which does not appear maintained anymore, which furthermore does not really run properly with the newer version of Typescript I put in the project. Remember to do something like `npm install --no-save typescript@3.3.1` before using the lint scripts. Since the build script also calls the lint script before building, and the code does not compile in old Typescript, the build script does not quite work. One may directly invoke tsc to build instead `rm -r dist; node_modules/.bin/tsc --outDir dist/reactnative`. 

The implementation of the preserveVisiblePosition algorithm for horizontal lists should be completely analogous and straightforward for anyone wondering if they wanted to get that working.

Since we always rely on accurate scroll events, we are always setting ScrollView to use `scrollEventThrottle` of 16 i.e. fire scroll events as much as once per frame.

In certain situations on certain low-end devices, scroll events may be severely delayed in some cases so that no scroll events fire for a long period of time even though the user is scrolling. Refix, with old scroll offsets, may kick in even though the user is scrolling, causing layouts to jump.

On data changes with `shiftPreservedLayouts`, I have assumed that all layout changes due to item removals can be handled by the layout shifting. This may not be the case when items are removed in the middle of lists; it should be possible to handle this case better.

When used from `@irisjae/flash-list`, `ListHeaderComponentSize` size changes may still affect the visible position, as it is not implemented as part of the list.

While I have performed testing with `@irisjae/recyclerlistview` in its own right, I have spent the majority of testing together with `@irisjae/flash-list`, so if possible, I recommend using them together.


---

Beneath the following line one finds the original README unmodified, save for the inclusion of props introduced by this patch to the props table.

---

# RecyclerListView

[![npm version](https://img.shields.io/npm/v/recyclerlistview.svg)](https://www.npmjs.com/package/recyclerlistview)
[![appveyor](https://ci.appveyor.com/api/projects/status/uwnp3r49127esj7k/branch/master?svg=true)](https://ci.appveyor.com/project/naqvitalha/recyclerlistview/branch/master)
[![License](https://img.shields.io/badge/License-Apache%202.0-brightgreen.svg)](https://opensource.org/licenses/Apache-2.0)

If this project has helped you out, please support us with a star :star2:.

This is a high performance listview for React Native and Web with support for complex layouts. JS only with no native dependencies, inspired by both RecyclerView on Android
and UICollectionView on iOS.

`npm install --save recyclerlistview`

For latest beta:  
`npm install --save recyclerlistview@beta`

* **[Overview and features](#overview-and-features)**
* **[Why?](#why)**
* **[Demo](#demo)**
* **[Props](#props)**
* **[Typescript](#typescript)**
* **[Guides](#guides)**
* **[License](#license)**
* **[Contact us](#contact-us)**

Note: Documentation will be upgraded soon, for now check code comments for clarity and exploring features. This component is actively tested with React Native Web as well.


## Overview and features
RecyclerListView uses "cell recycling" to reuse views that are no longer visible to render items instead of creating new view objects. Creation of objects
is very expensive and comes with a memory overhead which means as you scroll through the list the memory footprint keeps going up. Releasing invisible items off
memory is another technique but that leads to creation of even more objects and lot of garbage collections. Recycling is the best way to render infinite lists
that does not compromise performance or memory efficiency.

Apart from all performance benefits RecyclerListView comes with great features out of the box:
- Cross Platform, works on Web
- Supports staggered grid layouts
- Supports variable height items even if dimensions cannot be predetermined (prop - `forceNonDeterministicRendering`)
- Instant layout switching like going from GridView to ListView and vice versa
- End reach detections
- Horizontal Mode
- Viewability Events
- Initial render offset/index support
- Footer support
- Reflow support on container size change with first visible item preservation
- Scroll position preservation
- Window scrolling support for web
- (New) ItemAnimator interface added, customize to your will how RLV handles layout changes. Allows you to modify animations that move cells. You can do things like smoothly move an item to a new position when height of one of the cells has changed.
- (New) Stable Id support, ability to associate a stable id with an item. Will enable beautiful add/remove animations and optimize re-renders when DataProvider is updated.
- (New) Sticky recycler items that stick to either the top or bottom.

## Why?

RecyclerListView was built with performance in mind which means no blanks while quick scrolls or frame drops.
RecyclerListView encourages you to have deterministic heights for items you need to render. This does not mean that you need to have all items of same height and stuff, all you need
is a way to look at the data and compute height upfront so that RecyclerListView can compute layout in one pass rather than waiting for the draw to happen.
You can still do all sorts of GridViews and ListViews with different types of items which are all recycled in optimal ways. Type based recycling is very easy
to do and comes out of the box.

In case you cannot determine heights of items in advance just set `forceNonDeterministicRendering` prop to true on RecyclerListView. Now, it will treat given dimensions as estimates and let items resize. Try to give good estimates to improve experience.


## Demo

**Production Flipkart Grocery Demo Video (or try the app):** https://youtu.be/6YqEqP3MmoU  
**Infinite Loading/View Change (Expo):** https://snack.expo.io/@naqvitalha/rlv-demo  
**Mixed ViewTypes:** https://snack.expo.io/B1GYad52b  
**extendedState,stableIDs and ItemAnimator (Expo):** https://snack.expo.io/@arunreddy10/19bb8e  
**Sample project:** https://github.com/naqvitalha/travelMate  
**Web Sample (Using RNW):** https://codesandbox.io/s/k54j2zx977, https://jolly-engelbart-8ff0d0.netlify.com/  
**Context Preservation Sample:** https://github.com/naqvitalha/recyclerlistview-context-preservation-demo

**Other Video:** https://www.youtube.com/watch?v=Tnv4HMmPgMc

[![Watch Video](https://img.youtube.com/vi/Tnv4HMmPgMc/0.jpg)](https://www.youtube.com/watch?v=Tnv4HMmPgMc)

## Props

| Prop | Required | Params Type | Description |
| --- | --- | --- | --- |
| preserveVisiblePosition | No | boolean | Enables an alternate layout algorithm which is superior when the list has large regions where item heights are not precisely known.  The alternate algorithm calculates layouts by assuming that the offset of an item chosen from the visible region is correct and to be fixed at its current position, as opposed to the default algorithm which assumes that the layouts in front of the visible and engaged region is correct and fixed to the start of the scroller. This algorithm works well when the estimated size of items can be very far off from the correct value. Only vertical layouts with a single column is implemented for preserveVisiblePosition at the moment. <br> Because the preserveVisiblePosition layout algorithm performs layouting by forcibly assuming the positioning of visible items to be correct, this can cause the list to be offset at the edges. This will cause issues when the scroll position is close to edges such that the edge is visible. To correct for this, when the user stops scrolling, or the user moves close to edges, the list will trigger "refix" operations that recalibrates the physical locations of offsets and scroll positions to the correct logical locations. |
| nonDeterministicMode | No | "autolayout" \| "normal" | This props selects the method of determining rendered layouts with forceNonDeterministicRendering.  This should usually be 'normal', which detects rendered layout sizes using the onLayout event from View.  If the provided renderContentContainer supports the onAutoLayout event, 'autolayout' can be provided to this prop, so that information from onAutoLayout is used instead. This allows information on all the rendered items to be taken into account, so that it has potential to be faster and should not cause issues due to onLayouts of items arriving at different timings or being dropped. Furthermore, the autolayout mode allows the rendered offset to be taken into account, as opposed to just the heights of items. The preserveVisiblePosition layout algorithm will attempt to cooperate with the rendered offset from autolayout whenever possible, so that layout shifts due to mismatch between rendered layout and the logical layout are minimized. If possible, this should be used if the renderContentContainer component performs layouting by itself. |
| edgeVisibleThreshold | No | number | For controlling edge thresholds for refixing and for preserving positions |
| startEdgePreserved | No | boolean | For controlling whether visible region should still be preserved even when scroll is near the start of list |
| shiftPreservedLayouts | No | boolean | Enables preserving calculated layouts on (small) data changes; suitable if changes are mostly new items at edges, rather than modifications which change item size |
| layoutProvider | Yes | BaseLayoutProvider | Constructor function that defines the layout (height / width) of each element |
| dataProvider | Yes | DataProvider | Constructor function the defines the data for each element |
| contextProvider | No | ContextProvider | Used to maintain scroll position in case view gets destroyed, which often happens with back navigation |
| rowRenderer | Yes | (type: string \| number, data: any, index: number) => JSX.Element \| JSX.Element[] \| null | Method that returns react component to be rendered. You get the type, data, index and extendedState of the view in the callback | 
| initialOffset | No | number | Initial offset you want to start rendering from; This is very useful if you want to maintain scroll context across pages. | 
| renderAheadOffset | No | number | specify how many pixels in advance you want views to be rendered. Increasing this value can help reduce blanks (if any). However, keeping this as low as possible should be the intent. Higher values also increase re-render compute |
| isHorizontal | No | boolean | If true, the list will operate horizontally rather than vertically | 
| onScroll | No | rawEvent: ScrollEvent, offsetX: number, offsetY: number) => void | On scroll callback function that executes as a user scrolls |
| onRecreate | No | (params: OnRecreateParams) => void | callback function that gets executed when recreating the recycler view from context provider |
| externalScrollView | No | { new (props: ScrollViewDefaultProps): BaseScrollView } | Use this to pass your on implementation of BaseScrollView |
| onEndReached | No | () => void | Callback function executed when the end of the view is hit (minus onEndThreshold if defined) |
| onEndReachedThreshold | No | number | Specify how many pixels in advance for the onEndReached callback |
| onEndReachedThresholdRelative | No | number | Specify how far from the end (in units of visible length of the list) the bottom edge of the list must be from the end of the content to trigger the onEndReached callback |
| onVisibleIndicesChanged | No | TOnItemStatusChanged | Provides visible index; helpful in sending impression events |
| onVisibleIndexesChanged | No | TOnItemStatusChanged | (Deprecated in 2.0 beta) Provides visible index; helpful in sending impression events |
| renderFooter | No | () => JSX.Element \| JSX.Element[] \| null | Provide this method if you want to render a footer. Helpful in showing a loader while doing incremental loads |
| initialRenderIndex | No | number | Specify the initial item index you want rendering to start from. Preferred over initialOffset if both specified |
| scrollThrottle | No | number |iOS only; Scroll throttle duration |
| canChangeSize | No | boolean | Specify if size can change |
| distanceFromWindow | No | number | **(Depricated)** Use `applyWindowCorrection()` API with `windowShift`. **[Usage?](#applywindowcorrection-usage)** |
| applyWindowCorrection | No | (offset: number, windowCorrection: WindowCorrection) => void | (Enhancement/replacement to `distanceFromWindow` API) Allows updation of the visible windowBounds to based on correctional values passed. User can specify **windowShift**; in case entire RecyclerListWindow needs to shift down/up, **startCorrection**; in case when top window bound needs to be shifted for e.x. top window bound to be shifted down is a content overlapping the top edge of RecyclerListView, **endCorrection**: to alter bottom window bound for a similar use-case. **[Usage?](#applywindowcorrection-usage)** |
| useWindowScroll | No | boolean | Web only; Layout Elements in window instead of a scrollable div |
| disableRecycling | No | boolean | Turns off recycling |
| forceNonDeterministicRendering | No | boolean | Default is false; if enabled dimensions provided in layout provider will not be strictly enforced. Use this if item dimensions cannot be accurately determined |
| extendedState | No | object | In some cases the data passed at row level may not contain all the info that the item depends upon, you can keep all other info outside and pass it down via this prop. Changing this object will cause everything to re-render. Make sure you don't change it often to ensure performance. Re-renders are heavy. |
| itemAnimator | No | ItemAnimator | Enables animating RecyclerListView item cells (shift, add, remove, etc) |
| style | No | object | To pass down style to inner ScrollView |
| scrollViewProps | No | object | For all props that need to be proxied to inner/external scrollview. Put them in an object and they'll be spread and passed down. |
| layoutSize | No | Dimension | Will prevent the initial empty render required to compute the size of the listview and use these dimensions to render list items in the first render itself. This is useful for cases such as server side rendering. The prop canChangeSize has to be set to true if the size can be changed after rendering. Note that this is not the scroll view size and is used solely for layouting. |
| onItemLayout | No | number | A callback function that is executed when an item of the recyclerListView (at an index) has been layout. This can also be used as a proxy to itemsRendered kind of callbacks. |
| windowCorrectionConfig | No | object | Used to specify is window correction config and whether it should be applied to some scroll events |

For full feature set have a look at prop definitions of [RecyclerListView](https://github.com/Flipkart/recyclerlistview/blob/21049cc89ad606ec9fe8ea045dc73732ff29eac9/src/core/RecyclerListView.tsx#L540-L634)
(bottom of the file). All `ScrollView` features like `RefreshControl` also work out of the box.

### applyWindowCorrection usage

`applyWindowCorrection` is used to alter the visible window bounds of the RecyclerListView dynamically. The windowCorrection of RecyclerListView along with the current scroll offset are exposed to the user. The `windowCorrection` object consists of 3 numeric values:
 - `windowShift`        - Direct replacement of `distanceFromWindow` parameter. Window shift is the offset value by which the RecyclerListView as a whole is displaced within the StickyContainer, use this param to specify how far away the first list item is from window top. This value corrects the scroll offsets for StickyObjects as well as RecyclerListView.
 - `startCorrection`    - startCorrection is used to specify the shift in the top visible window bound, with which user can receive the correct Sticky header instance even when an external factor like CoordinatorLayout toolbar. 
 - `endCorrection`      - endCorrection is used to specify the shift in the bottom visible window bound, with which user can receive correct Sticky Footer instance when an external factor like bottom app bar is changing the visible view bound.

As seen in the example below

![Alt Text](/docs/images/getWindowCorrection_demo.gif)

## Typescript

Typescript works out of the box. The only execption is with the inherited Scrollview props. In order for Typescript to work with inherited Scrollview props, you must place said inherited Scrollview props within the scrollViewProps prop.

```javascript
<RecyclerListView
  rowRenderer={this.rowRenderer}
  dataProvider={queue}
  layoutProvider={this.layoutProvider}
  onScroll={this.checkRefetch}
  renderFooter={this.renderFooter}
  scrollViewProps={{
    refreshControl: (
      <RefreshControl
        refreshing={loading}
        onRefresh={async () => {
          this.setState({ loading: true });
          analytics.logEvent('Event_Stagg_pull_to_refresh');
          await refetchQueue();
          this.setState({ loading: false });
        }}
      />
    )
  }}
/>
```

## Guides
* **[Sample Code](https://github.com/Flipkart/recyclerlistview/tree/master/docs/guides/samplecode)**
* **[Performance](https://github.com/Flipkart/recyclerlistview/tree/master/docs/guides/performance)**
* **[Sticky Guide](https://github.com/Flipkart/recyclerlistview/tree/master/docs/guides/sticky)**
* **Web Support:** Works with React Native Web out of the box. For use with ReactJS start importing from `recyclerlistview/web` e.g., `import { RecyclerListView } from "recyclerlistview/web"`. Use aliases if you want to preserve import path. Only platform specific code is part of the build so, no unnecessary code will ship with your app.
* **Polyfills Needed:** `requestAnimationFrame`, `ResizeObserver`

## License
**[Apache v2.0](https://github.com/Flipkart/recyclerlistview/blob/master/LICENSE.md)**

## Contact Us
Please open issues for any bugs that you encounter. You can reach out to me on twitter [@naqvitalha](https://www.twitter.com/naqvitalha) or, write to cross-platform@flipkart.com for any questions that
you might have.
