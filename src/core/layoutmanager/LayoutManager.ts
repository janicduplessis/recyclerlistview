/***
 * Computes the positions and dimensions of items that will be rendered by the list. The output from this is utilized by viewability tracker to compute the
 * lists of visible/hidden item.
 */
import throttle = require("lodash.throttle");
import * as React from "react";
import BaseScrollComponent from "../scrollcomponent/BaseScrollComponent";
import VirtualRenderer from "../VirtualRenderer";
import { Dimension, LayoutProvider } from "../dependencies/LayoutProvider";
import CustomError from "../exceptions/CustomError";

export abstract class LayoutManager {
    public getOffsetForIndex(index: number): Point {
        const layouts = this.getLayouts();
        if (layouts.length > index) {
            return { x: layouts[index].x, y: layouts[index].y };
        } else {
            throw new CustomError({
                message: "No layout available for index: " + index,
                type: "LayoutUnavailableException",
            });
        }
    }

    //You can ovveride this incase you want to override style in some cases e.g, say you want to enfore width but not height
    public getStyleOverridesForIndex(index: number): object | undefined {
        return undefined;
    }

    //Removes item at the specified index
    public removeLayout(index: number): void {
        const layouts = this.getLayouts();
        if (index < layouts.length) {
            layouts.splice(index, 1);
        }
        if (index === 0 && layouts.length > 0) {
            const firstLayout = layouts[0];
            firstLayout.x = 0;
            firstLayout.y = 0;
        }
    }

    //Return the dimension of entire content inside the list
    public abstract getContentDimension(): Dimension;

    //Return all computed layouts as an array, frequently called, you are expected to return a cached array. Don't compute here.
    public abstract getLayouts(): Layout[];

    //RLV will call this method in case of mismatch with actual rendered dimensions in case of non deterministic rendering
    //You are expected to cache this value and prefer it over estimates provided
    //No need to relayout which RLV will trigger. You should only relayout when relayoutFromIndex is called.
    //Layout managers can choose to ignore the override requests like in case of grid layout where width changes
    //can be ignored for a vertical layout given it gets computed via the given column span.
    public abstract overrideLayout(index: number, dim: Dimension): boolean;

    //Recompute layouts from given index, compute heavy stuff should be here
    public abstract relayoutFromIndex(startIndex: number, itemCount: number): void;

    public abstract refix(
        scrollComponent: BaseScrollComponent,
        innerScrollComponent: React.Component,
        scrollHeight: number,
        baseOffset: number,
        indexes: Array<number | undefined>,
        itemCount: number,
        virtualRenderer: VirtualRenderer,
        retrigger: (height: number) => void,
    ): void;
    public abstract preservedIndex(): number;
    public abstract preparePreservedIndex(firstVisibleIndex: number): void;
    public abstract preservedIndexThrottle(): number;
    public abstract holdPreservedIndex(index: number): void;
    public abstract unholdPreservedIndex(): void;
    public abstract shiftPreservedIndex(index: number, shiftPreservedIndex: number): void;
    public abstract shiftLayouts(indexOffset: number): void;
}

export class WrapGridLayoutManager extends LayoutManager {
    private _layoutProvider: LayoutProvider;
    private _window: Dimension;
    private _totalHeight: number;
    private _totalWidth: number;
    private _isHorizontal: boolean;
    private _layouts: Layout[];

    private _anchorCount: number = 0;
    private _fixIndex: number = -1;
    private _pendingFixY: number | undefined = undefined;
    private _holdingIndex: boolean = false;

    private _preparePreservedIndex = throttle ((firstVisibleIndex: number): void => {
        if ((this._fixIndex > -1) || (firstVisibleIndex >= this._anchorCount)) {
            this._fixIndex = firstVisibleIndex;
        }
    }, 200);

    constructor(layoutProvider: LayoutProvider, renderWindowSize: Dimension, isHorizontal: boolean = false, cachedLayouts?: Layout[]) {
        super();
        this._layoutProvider = layoutProvider;
        this._window = renderWindowSize;
        this._totalHeight = 0;
        this._totalWidth = 0;
        this._isHorizontal = !!isHorizontal;
        this._layouts = cachedLayouts ? cachedLayouts : [];
    }

    public preservedIndex(): number {
        return this._fixIndex;
    }
    public preparePreservedIndex(firstVisibleIndex: number): void {
        if (!this._holdingIndex) {
            this._preparePreservedIndex(firstVisibleIndex);
        }
    }
    public preservedIndexThrottle(): number {
        // TODO: refactor with above 200 (from _preparePreservedIndex)
        return 200;
    }
    public holdPreservedIndex(index: number): void {
        this._fixIndex = index;
        this._holdingIndex = true;
        this._preparePreservedIndex.cancel();
    }
    public unholdPreservedIndex(): void {
        this._holdingIndex = false;
    }
    public shiftPreservedIndex(index: number, shiftPreservedIndex: number): void {
        this._fixIndex = shiftPreservedIndex;
        this._pendingFixY = this._layouts[index].y;
        this._preparePreservedIndex.cancel();
    }
    public shiftLayouts(indexOffset: number): void {
        // shift existing layout by an offset
        // this is called when data changes
        // purpose is: assuming that most layout sizes have not changed, we want to keep existing
        // values of layout sizes already obtained, so that we prevent layout thrashing
        // this is especially relevant the data change happens after many layouts have been overridden
        // so the layouting trusts the values, but if all indices are shifted, they could be all wrong

        // fill in invalid placeholder values; these will be properly calculated during relayout
        if (indexOffset > 0) {
            const layoutCount = this._layouts.length;
            const placeholderLayouts = [];
            for (let i = 0; i < indexOffset; i++) {
                placeholderLayouts.push({ x: 0, y: 0, height: 0, width: 0, type: 0 });
            }
            this._layouts.splice(0, 0, ...placeholderLayouts);
        } else if (indexOffset < 0) {
            this._layouts.splice(0, - indexOffset);
        }
    }

    public getContentDimension(): Dimension {
        return { height: this._totalHeight, width: this._totalWidth };
    }

    public getLayouts(): Layout[] {
        return this._layouts;
    }

    public getOffsetForIndex(index: number): Point {
        if (this._layouts.length > index) {
            return { x: this._layouts[index].x, y: this._layouts[index].y };
        } else {
            throw new CustomError({
                message: "No layout available for index: " + index,
                type: "LayoutUnavailableException",
            });
        }
    }

    public overrideLayout(index: number, dim: Dimension): boolean {
        const layout = this._layouts[index];
        if (layout) {
            if ((!layout.isOverridden) && index === this._anchorCount) {
                let i = this._anchorCount;
                while (this._layouts[i + 1] && this._layouts[i + 1].isOverridden) {
                    i++;
                }
                this._anchorCount = i + 1;
            }
            layout.isOverridden = true;
            layout.width = dim.width;
            layout.height = dim.height;
        }
        return true;
    }

    public setMaxBounds(itemDim: Dimension): void {
        if (this._isHorizontal) {
            itemDim.height = Math.min(this._window.height, itemDim.height);
        } else {
            itemDim.width = Math.min(this._window.width, itemDim.width);
        }
    }

    //TODO:Talha laziliy calculate in future revisions
    public relayoutFromIndex(startIndex: number, itemCount: number): void {
        startIndex = this._locateFirstNeighbourIndex(startIndex);
        let startX = 0;
        let startY = 0;
        let maxBound = 0;

        const oldItemCount = this._layouts.length;
        const itemDim = { height: 0, width: 0 };
        let itemRect = null;

        let oldLayout = null;

        let index = startIndex;

        if ((startIndex <= this._fixIndex) && (this._fixIndex < oldItemCount)) {
            for (; index < Math.min(itemCount - 1, this._fixIndex); index++) {
                oldLayout = this._layouts[index];
                const layoutType = this._layoutProvider.getLayoutTypeForIndex(index);
                if (oldLayout && oldLayout.isOverridden && oldLayout.type === layoutType) {
                    itemDim.height = oldLayout.height;
                    itemDim.width = oldLayout.width;
                } else {
                    this._layoutProvider.setComputedLayout(layoutType, itemDim, index);
                }
                this.setMaxBounds(itemDim);

                itemRect = this._layouts[index];
                itemRect.type = layoutType;
                itemRect.width = itemDim.width;
                itemRect.height = itemDim.height;
            }

            oldLayout = this._layouts[index];
            const fixLayoutType = this._layoutProvider.getLayoutTypeForIndex(index);
            if (oldLayout && oldLayout.isOverridden && oldLayout.type === fixLayoutType) {
                itemDim.height = oldLayout.height;
                itemDim.width = oldLayout.width;
            } else {
                this._layoutProvider.setComputedLayout(fixLayoutType, itemDim, index);
            }
            this.setMaxBounds(itemDim);

            itemRect = this._layouts[index];
            itemRect.type = fixLayoutType;
            itemRect.width = itemDim.width;
            itemRect.height = itemDim.height;

            // fix backwards
            if (this._pendingFixY !== undefined) {
                itemRect.y = this._pendingFixY;
                this._pendingFixY = undefined;
            }
            let fixY = itemRect.y;
            let i = index - 1;
            for (; i >= startIndex; i --) {
                fixY -= this._layouts[i].height;
                this._layouts[i].y = fixY;
            }
            for (; i >= 0; i --) {
                fixY -= this._layouts[i].height;
                if (this._layouts[i].y === fixY) {
                        break;
                } else {
                        this._layouts[i].y = fixY;
                }
            }

            // set loop state as if looped until index
            maxBound = itemDim.height;

            const startVal = this._layouts[index];
            startX = itemDim.width;
            startY = startVal.y;
            this._pointDimensionsToRect(startVal);

            index = index + 1;
        } else {
            const startVal = this._layouts[startIndex];
            if (startVal) {
                startX = startVal.x;
                startY = startVal.y;
                this._pointDimensionsToRect(startVal);
            }
        }

        for (; index < itemCount; index++) {
            oldLayout = this._layouts[index];
            const layoutType = this._layoutProvider.getLayoutTypeForIndex(index);
            if (oldLayout && oldLayout.isOverridden && oldLayout.type === layoutType) {
                itemDim.height = oldLayout.height;
                itemDim.width = oldLayout.width;
            } else {
                this._layoutProvider.setComputedLayout(layoutType, itemDim, index);
            }
            this.setMaxBounds(itemDim);
            if (!this._checkBounds(startX, startY, itemDim, this._isHorizontal)) {
                if (this._isHorizontal) {
                    startX += maxBound;
                    startY = 0;
                    this._totalWidth += maxBound;
                } else {
                    startX = 0;
                    startY += maxBound;
                    this._totalHeight += maxBound;
                }
                maxBound = 0;
            }

            maxBound = this._isHorizontal ? Math.max(maxBound, itemDim.width) : Math.max(maxBound, itemDim.height);

            //TODO: Talha creating array upfront will speed this up
            if (index > oldItemCount - 1) {
                this._layouts.push({ x: startX, y: startY, height: itemDim.height, width: itemDim.width, type: layoutType });
            } else {
                itemRect = this._layouts[index];
                itemRect.x = startX;
                itemRect.y = startY;
                itemRect.type = layoutType;
                itemRect.width = itemDim.width;
                itemRect.height = itemDim.height;
            }

            if (this._isHorizontal) {
                startY += itemDim.height;
            } else {
                startX += itemDim.width;
            }
        }

        if (oldItemCount > itemCount) {
            this._layouts.splice(itemCount, oldItemCount - itemCount);
        }
        this._setFinalDimensions(maxBound);
    }

    public refix(
        scrollComponent: BaseScrollComponent,
        innerScrollComponent: React.Component,
        scrollHeight: number,
        baseOffset: number,
        indexes: Array<number | undefined>,
        itemCount: number,
        virtualRenderer: VirtualRenderer,
        retrigger: (height: number) => void,
    ): void {
        const refixOffset = - this._layouts[0].y;

        // if the content height is not as tall as the scroll destination, scrollTo will fail
        // so, we must first set the height the content before we do the rest of refix
        if (refixOffset > 0 && scrollHeight < Math.min(baseOffset, this._totalHeight) + refixOffset) {
            // @ts-ignore
            innerScrollComponent.setNativeProps({ style: { height: this._totalHeight + refixOffset } });
            // @ts-ignore
            innerScrollComponent.measure((x, y, width, height, pageX, pageY) => {
                retrigger(height);
            });
        } else {
            if (refixOffset !== 0) {
                for (let i = 0; i < itemCount; i++) {
                    this._layouts[i].y += refixOffset;
                }
                this._totalHeight += refixOffset;

                // @ts-ignore
                innerScrollComponent.setNativeProps({ style: { height: this._totalHeight } });

                for (let i = 0; i < indexes.length; i++) {
                    const index = indexes[i];
                    if (index !== undefined) {
                        const y = this._layouts[index].y;
                        // @ts-ignore
                        innerScrollComponent._children[i].setNativeProps({ style: { top: y } });
                    }
                }
                scrollComponent.scrollTo(0, baseOffset + refixOffset, false);

                const viewabilityTracker = virtualRenderer.getViewabilityTracker();
                if (viewabilityTracker) {
                    (viewabilityTracker as any)._currentOffset += refixOffset;
                    (viewabilityTracker as any)._maxOffset += refixOffset;
                    (viewabilityTracker as any)._visibleWindow.start += refixOffset;
                    (viewabilityTracker as any)._visibleWindow.end += refixOffset;
                    (viewabilityTracker as any)._engagedWindow.start += refixOffset;
                    (viewabilityTracker as any)._engagedWindow.end += refixOffset;
                    (viewabilityTracker as any)._actualOffset += refixOffset;
                }
            }

            // reset fix
            if (this._fixIndex < this._anchorCount) {
                this._fixIndex = -1;
            }
        }
    }

    private _pointDimensionsToRect(itemRect: Layout): void {
        if (this._isHorizontal) {
            this._totalWidth = itemRect.x;
        } else {
            this._totalHeight = itemRect.y;
        }
    }

    private _setFinalDimensions(maxBound: number): void {
        if (this._isHorizontal) {
            this._totalHeight = this._window.height;
            this._totalWidth += maxBound;
        } else {
            this._totalWidth = this._window.width;
            this._totalHeight += maxBound;
        }
    }

    private _locateFirstNeighbourIndex(startIndex: number): number {
        if (startIndex === 0) {
            return 0;
        }
        let i = startIndex - 1;
        for (; i >= 0; i--) {
            if (this._isHorizontal) {
                if (this._layouts[i].y === 0) {
                    break;
                }
            } else if (this._layouts[i].x === 0) {
                break;
            }
        }
        return i;
    }

    private _checkBounds(itemX: number, itemY: number, itemDim: Dimension, isHorizontal: boolean): boolean {
        return isHorizontal ? (itemY + itemDim.height <= this._window.height + 0.9) : (itemX + itemDim.width <= this._window.width + 0.9);
    }
}

export interface Layout extends Dimension, Point {
    isOverridden?: boolean;
    type: string | number;
}
export interface Point {
    x: number;
    y: number;
}
