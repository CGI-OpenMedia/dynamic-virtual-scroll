/**
 * Virtual scroll driver for dynamic row heights
 *
 * License: GNU LGPLv3.0+
 * (c) Vitaliy Filippov 2018+
 *
 */

 export type DriverProps = {
    readonly totalItems: number;
    readonly minRowHeight: number;
    readonly viewportHeight: number;
    readonly scrollTop: number;
}

interface DriverStateWrite {
    [key: string]: number;          //internal props used by the module
    targetHeight: number;           //estimated total height for all items, used to size a container elem of items inside of scroll container
    topPlaceholderHeight: number;
    firstMiddleItem: number;
    middleItemCount: number;
    middlePlaceholderHeight: number;
    lastItemCount: number;

    avgRowHeight: number;       //used by keep steady feature
}

/** Consumer is not supposed to mutate state */
export type DriverState = Readonly<DriverStateWrite>

export const initDriverState: DriverState = {
    targetHeight: 0,
    topPlaceholderHeight: 0,
    firstMiddleItem: 0,
    middleItemCount: 0,
    middlePlaceholderHeight: 0,
    lastItemCount: 0,

    avgRowHeight: 0
}

/**
 * @returns 0 when index invalid (NaN) or item not rendered yet
 */
type GetRenderedItemHeightCallback = (itemIndex: number /*can be NaN*/) => number

/** @param props { totalItems, minRowHeight, viewportHeight, scrollTop }
 * @param oldState - previous state object
 * @param getRenderedItemHeight = (itemIndex) => height
 *     this function MUST return the height of currently rendered item or 0 if it's not currently rendered
 *     the returned height MUST be >= props.minRowHeight
 *     the function MAY cache heights of rendered items if you want your list to be more responsive
 * @returns new state object
 *     you MUST re-render your list when any state values change
 *     you MUST preserve all keys in the state object and pass it back via `oldState` on the next run
 *     you MUST use the following keys for rendering:
 *         newState.targetHeight - height of the 1px wide invisible div you should render in the scroll container
 *         newState.topPlaceholderHeight - height of the first (top) placeholder. omit placeholder if it is 0
 *         newState.firstMiddleItem - first item to be rendered after top placeholder
 *         newState.middleItemCount - item count to be renderer after top placeholder. omit items if it is 0
 *         newState.middlePlaceholderHeight - height of the second (middle) placeholder. omit placeholder if it is 0
 *         newState.lastItemCount - item count to be rendered in the end of the list
 */
export function virtualScrollDriver(
    props: DriverProps,
    oldState: DriverState,
    getRenderedItemHeight: GetRenderedItemHeightCallback): DriverState {
    const viewportHeight = props.viewportHeight;
    const viewportItemCount = Math.ceil(viewportHeight / props.minRowHeight); // +border?
    const newState: DriverStateWrite = {
        viewportHeight,
        viewportItemCount,
        totalItems: props.totalItems,
        scrollHeightInItems: oldState.scrollHeightInItems,
        avgRowHeight: oldState.avgRowHeight,
        targetHeight: 0,
        topPlaceholderHeight: 0,
        firstMiddleItem: 0,
        middleItemCount: 0,
        middlePlaceholderHeight: 0,
        lastItemCount: props.totalItems,
        lastItemsTotalHeight: oldState.lastItemsTotalHeight,
    };

    //if (!oldState.viewportHeight)
    //{
    //    oldState = { ...oldState };
    //    for (let k in newState)
    //    {
    //        oldState[k] = oldState[k] || 0;
    //    }
    //}
    const oldStateAvgRowHeight = oldState.viewportHeight ? oldState.avgRowHeight : (oldState.avgRowHeight || 0)

    if (2*newState.viewportItemCount >= props.totalItems)
    {
        // We need at least 2*viewportItemCount to perform virtual scrolling
        return newState;
    }
    newState.lastItemCount = newState.viewportItemCount;
    {
        let lastItemsHeight = 0, lastVisibleItems = 0;
        let lastItemSize;
        while (lastItemsHeight < viewportHeight)
        {
            lastItemSize = getRenderedItemHeight(props.totalItems - 1 - lastVisibleItems);
            //if (!lastItemSize)
            //{
            //    // Some required items in the end are missing
            //    lastItemSize = 0;
            //}
            //lastItemsHeight += lastItemSize < props.minRowHeight ? props.minRowHeight : lastItemSize;
            //lastItemSize is used below to calc 'scrollHeightInItems'
            //assign default value used here if item missing to avoid divide by zero
            if (!lastItemSize || lastItemSize < props.minRowHeight) {
                // Some required items in the end are missing
                lastItemSize = props.minRowHeight;
            }
            lastItemsHeight += lastItemSize;
            lastVisibleItems++;
        }
        newState.scrollHeightInItems = props.totalItems - lastVisibleItems + (lastItemsHeight - viewportHeight) / lastItemSize;
        //this change produced update error (too many nested loops)
        //take into account not only the last one but the average height
        //newState.scrollHeightInItems = props.totalItems - lastVisibleItems +
        //    (lastItemsHeight - viewportHeight) / (lastItemsHeight / lastVisibleItems);

        // Calculate heights of the rest of items
        while (lastVisibleItems < newState.viewportItemCount)
        {
            lastItemsHeight += getRenderedItemHeight(props.totalItems - 1 - lastVisibleItems);
            lastVisibleItems++;
        }
        newState.lastItemsTotalHeight = lastItemsHeight;
        newState.avgRowHeight = lastItemsHeight / lastVisibleItems;
        newState.avgRowHeight = !oldStateAvgRowHeight || newState.avgRowHeight > oldStateAvgRowHeight
            ? newState.avgRowHeight
            : oldStateAvgRowHeight;
    }
    newState.targetHeight = newState.avgRowHeight * newState.scrollHeightInItems + newState.viewportHeight;
    const scrollTop = props.scrollTop;
    let scrollPos = scrollTop / (newState.targetHeight - newState.viewportHeight);
    if (scrollPos > 1)
    {
        // Rare case - avgRowHeight isn't enough and we need more
        // avgRowHeight will be corrected after rendering all items
        scrollPos = 1;
    }
    let firstVisibleItem = scrollPos * newState.scrollHeightInItems;
    const firstVisibleItemOffset = firstVisibleItem - Math.floor(firstVisibleItem);
    // FIXME: Render some items before current for smoothness
    firstVisibleItem = Math.floor(firstVisibleItem);
    const firstVisibleItemHeight = getRenderedItemHeight(firstVisibleItem) || newState.avgRowHeight;
    newState.topPlaceholderHeight = scrollTop - firstVisibleItemHeight*firstVisibleItemOffset;
    if (newState.topPlaceholderHeight < 0)
    {
        newState.topPlaceholderHeight = 0;
    }
    if (firstVisibleItem + newState.viewportItemCount >= props.totalItems - newState.viewportItemCount)
    {
        //set prop otherwise is always 0 (uninitialized) and 
        //the loop below with getRenderedItemHeight() would always start with index=0
        newState.firstMiddleItem = firstVisibleItem;
        // Only one placeholder is required
        newState.lastItemCount = props.totalItems - firstVisibleItem;
        let sum = 0, count = props.totalItems - newState.viewportItemCount - firstVisibleItem;
        count = count > 0 ? count : 0;
        for (let i = 0; i < count; i++)
        {
            const itemSize = getRenderedItemHeight(i+newState.firstMiddleItem);
            if (!itemSize)
            {
                // Some required items in the middle are missing
                return newState;
            }
            sum += itemSize;
        }
        const correctedAvg = (sum + newState.lastItemsTotalHeight) / (count + newState.viewportItemCount);
        if (correctedAvg > newState.avgRowHeight)
        {
            newState.avgRowHeight = correctedAvg;
        }
    }
    else
    {
        newState.firstMiddleItem = firstVisibleItem;
        newState.middleItemCount = newState.viewportItemCount;
        let sum = 0;
        for (let i = 0; i < newState.middleItemCount; i++)
        {
            const itemSize = getRenderedItemHeight(i+newState.firstMiddleItem);
            if (!itemSize)
            {
                // Some required items in the middle are missing
                return newState;
            }
            sum += itemSize;
        }
        newState.middlePlaceholderHeight = newState.targetHeight - sum - newState.lastItemsTotalHeight - newState.topPlaceholderHeight;
        if (newState.middlePlaceholderHeight < 0)
        {
            newState.middlePlaceholderHeight = 0;
        }
        const correctedAvg = (sum + newState.lastItemsTotalHeight) / (newState.middleItemCount + newState.viewportItemCount);
        if (correctedAvg > newState.avgRowHeight)
        {
            newState.avgRowHeight = correctedAvg;
        }
    }
    return newState;
}
