import * as React from "react";
import {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    ScrollView,
    View,
} from "react-native";
import BaseScrollComponent, { ScrollComponentProps } from "../../../core/scrollcomponent/BaseScrollComponent";
import TSCast from "../../../utils/TSCast";
/***
 * The responsibility of a scroll component is to report its size, scroll events and provide a way to scroll to a given offset.
 * RecyclerListView works on top of this interface and doesn't care about the implementation. To support web we only had to provide
 * another component written on top of web elements
 */

export default class ScrollComponent extends BaseScrollComponent {
    public static defaultProps = {
        contentHeight: 0,
        contentWidth: 0,
        externalScrollView: TSCast.cast(ScrollView), //TSI
        isHorizontal: false,
        scrollThrottle: 16,
    };

    private _height: number;
    private _width: number;
    private _isSizeChangedCalledOnce: boolean;
    private _scrollViewRef: ScrollView | null = null;

    constructor(args: ScrollComponentProps) {
        super(args);
        this._height = (args.layoutSize && args.layoutSize.height) || 0;
        this._width = (args.layoutSize && args.layoutSize.width) || 0;
        this._isSizeChangedCalledOnce = false;
    }

    public scrollTo(x: number, y: number, isAnimated: boolean): void {
        if (this._scrollViewRef) {
            this._scrollViewRef.scrollTo({ x, y, animated: isAnimated });
        }
    }

    public getScrollableNode(): number | null {
        if (this._scrollViewRef && this._scrollViewRef.getScrollableNode) {
          return this._scrollViewRef.getScrollableNode();
        }
        return null;
    }

    public getNativeScrollRef(): ScrollView | null {
        return this._scrollViewRef;
    }

    public render(): JSX.Element {
        const Scroller = TSCast.cast<ScrollView>(this.props.externalScrollView); //TSI
        const renderContentContainer = this.props.renderContentContainer ? this.props.renderContentContainer : this._defaultContainer;
        const contentContainerProps = {
            style: {
                height: this.props.contentHeight,
                width: this.props.contentWidth,
            },
            horizontal : this.props.isHorizontal,
            scrollOffset : this.props.scrollOffset,
            renderAheadOffset: this.props.renderAheadOffset,
            windowSize: (this.props.isHorizontal ? this._width : this._height) + this.props.renderAheadOffset,
            innerRef: this.props.innerRef,
            preservedIndex: this.props.preservedIndex,
            onAutoLayout: this.props.onAutoLayout,
            autoLayoutId: this.props.autoLayoutId,
        };
        //TODO:Talha
        // const {
        //     useWindowScroll,
        //     contentHeight,
        //     contentWidth,
        //     externalScrollView,
        //     canChangeSize,
        //     renderFooter,
        //     isHorizontal,
        //     scrollThrottle,
        //     ...props,
        // } = this.props;
        return (
            // @ts-ignore
            <Scroller ref={this._getScrollViewRef}
                removeClippedSubviews={false}
                scrollEventThrottle={this.props.scrollThrottle}
                {...this.props}
                horizontal={this.props.isHorizontal}
                onScroll={this._onScroll}
                onScrollBeginDrag={this._onScrollBeginDrag}
                onScrollEndDrag={this._onScrollEndDrag}
                onMomentumScrollBegin={this._onMomentumScrollBegin}
                onMomentumScrollEnd={this._onMomentumScrollEnd}
                onLayout={(!this._isSizeChangedCalledOnce || this.props.canChangeSize) ? this._onLayout : this.props.onLayout}>
                <View style={{ flexDirection: this.props.isHorizontal ? "row" : "column" }}>
                    {renderContentContainer(contentContainerProps, (this.props as any).children)}
                    {this.props.renderFooter ? this.props.renderFooter() : null}
                </View>
            </Scroller>
        );
    }

    private _defaultContainer(props: object, children: React.ReactNode): React.ReactNode | null {
        return (
	    // @ts-ignore
            <View ref={props.innerRef} {...props}>
                {children}
            </View>
        );
    }

    private _getScrollViewRef = (scrollView: any) => { this._scrollViewRef = scrollView as (ScrollView | null); };

    private _onScroll = (event?: NativeSyntheticEvent<NativeScrollEvent>): void => {
        if (event) {
            const contentOffset = event.nativeEvent.contentOffset;
            this.props.onScroll(contentOffset.x, contentOffset.y, event);
        }
    }

    private _onScrollBeginDrag = (event?: NativeSyntheticEvent<NativeScrollEvent>): void => {
        if (event) {
            const contentOffset = event.nativeEvent.contentOffset;
            this.props.onScrollBeginDrag(contentOffset.x, contentOffset.y, event);
        }
    }

    private _onScrollEndDrag = (event?: NativeSyntheticEvent<NativeScrollEvent>): void => {
        if (event) {
            const contentOffset = event.nativeEvent.contentOffset;
            this.props.onScrollEndDrag(contentOffset.x, contentOffset.y, event);
        }
    }

    private _onMomentumScrollBegin = (event?: NativeSyntheticEvent<NativeScrollEvent>): void => {
        if (event) {
            const contentOffset = event.nativeEvent.contentOffset;
            this.props.onMomentumScrollBegin(contentOffset.x, contentOffset.y, event);
        }
    }
    private _onMomentumScrollEnd = (event?: NativeSyntheticEvent<NativeScrollEvent>): void => {
        if (event) {
            const contentOffset = event.nativeEvent.contentOffset;
            this.props.onMomentumScrollEnd(contentOffset.x, contentOffset.y, event);
        }
    }

    private _onLayout = (event: LayoutChangeEvent): void => {
        if (this._height !== event.nativeEvent.layout.height || this._width !== event.nativeEvent.layout.width) {
            this._height = event.nativeEvent.layout.height;
            this._width = event.nativeEvent.layout.width;
            if (this.props.onSizeChanged) {
                this._isSizeChangedCalledOnce = true;
                this.props.onSizeChanged(event.nativeEvent.layout);
            }
        }
        if (this.props.onLayout) {
            this.props.onLayout(event);
        }
    }
}
