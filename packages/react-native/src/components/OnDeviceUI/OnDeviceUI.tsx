import { styled } from '@storybook/react-native-theming';
import { StoryIndex } from '@storybook/types';
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  // ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ANIMATION_DURATION_TRANSITION } from '../../constants';
import {
  useIsSplitPanelVisible,
  useIsUIVisible,
  useStoryContext,
  useStoryContextParam,
} from '../../hooks';
import StoryView from '../StoryView';
import AbsolutePositionedKeyboardAwareView, {
  PreviewDimens,
} from './absolute-positioned-keyboard-aware-view';

import { SET_CURRENT_STORY } from '@storybook/core-events';
import { addons } from '@storybook/manager-api';
import { useTheme } from '@storybook/react-native-theming';
import {
  // Explorer,
  // LayoutProvider,
  Selection,
  Sidebar,
  // useCombination,
} from '@storybook/react-native-ui';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { transformStoryIndexToStoriesHash } from '../StoryListView/StoryHash';
import Panel from './Panel';
import Addons from './addons/Addons';
import { AddonsSkeleton } from './addons/AddonsSkeleton';
import {
  getAddonPanelPosition,
  getPreviewShadowStyle,
  getPreviewStyle,
  getSidebarPanelPosition,
} from './animation';
import Navigation from './navigation';
import { ADDONS, CANVAS } from './navigation/constants';
import { DEFAULT_REF_ID } from '@storybook/react-native-ui/src/constants';

const IS_IOS = Platform.OS === 'ios';
// @ts-ignore: Property 'Expo' does not exist on type 'Global'
const getExpoRoot = () => global.Expo || global.__expo || global.__exponent;
export const IS_EXPO = getExpoRoot() !== undefined;
const IS_ANDROID = Platform.OS === 'android';
const BREAKPOINT = 1024;

interface OnDeviceUIProps {
  storyIndex: StoryIndex;
  url?: string;
  tabOpen?: number;
  shouldDisableKeyboardAvoidingView?: boolean;
  keyboardAvoidingViewVerticalOffset?: number;
}

const flex = { flex: 1 };

interface PreviewProps {
  animatedValue: Animated.Value;
  style: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Story preview container.
 */
function Preview({ animatedValue, style, children }: PreviewProps) {
  const theme = useTheme();
  const containerStyle = {
    backgroundColor: theme.preview.backgroundColor,
    ...getPreviewShadowStyle(animatedValue),
  };
  return (
    <Animated.View style={[flex, containerStyle]}>
      <View style={[flex, style]}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  expoAndroidContainer: { paddingTop: StatusBar.currentHeight },
});

const Container = styled.View(({ theme }) => ({
  flex: 1,
  backgroundColor: theme.preview.containerBackgroundColor,
  ...(IS_ANDROID && IS_EXPO ? styles.expoAndroidContainer : undefined),

  ...Platform.select({ web: { overflow: 'hidden' } }),
}));

const OnDeviceUI = ({
  storyIndex,
  shouldDisableKeyboardAvoidingView,
  keyboardAvoidingViewVerticalOffset,
  tabOpen: initialTabOpen,
}: OnDeviceUIProps) => {
  const story = useStoryContext();
  const [tabOpen, setTabOpen] = useState(initialTabOpen || CANVAS);
  const lastTabOpen = React.useRef(tabOpen);
  const [previewDimensions, setPreviewDimensions] = useState<PreviewDimens>(() => ({
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  }));
  const animatedValue = useRef(new Animated.Value(tabOpen));
  const wide = useWindowDimensions().width >= BREAKPOINT;
  const insets = useSafeAreaInsets();

  const handleToggleTab = React.useCallback(
    (newTabOpen: number) => {
      if (newTabOpen === tabOpen) {
        return;
      }
      lastTabOpen.current = tabOpen;
      Animated.timing(animatedValue.current, {
        toValue: newTabOpen,
        duration: ANIMATION_DURATION_TRANSITION,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
      setTabOpen(newTabOpen);

      // close the keyboard opened from a TextInput from story list or controls
      if (newTabOpen === CANVAS) {
        Keyboard.dismiss();
      }
    },
    [tabOpen]
  );

  const noSafeArea = useStoryContextParam<boolean>('noSafeArea', false);
  const previewWrapperStyles = [
    flex,
    getPreviewStyle({
      animatedValue: animatedValue.current,
      previewDimensions,
      wide,
      insets,
      tabOpen,
      lastTabOpen: lastTabOpen.current,
    }),
  ];

  const [isUIVisible] = useIsUIVisible();
  // The initial value is just a guess until the layout calculation has been done.
  const [navBarHeight, setNavBarHeight] = React.useState(insets.bottom + 40);
  const measureNavigation = React.useCallback(
    ({ nativeEvent }) => {
      const inset = insets.bottom;
      setNavBarHeight(isUIVisible ? nativeEvent.layout.height - inset : 0);
    },
    [isUIVisible, insets]
  );

  // There are 4 cases for the additional UI margin:
  //   1. Storybook UI is visible, and `noSafeArea` is false: Include top and
  //      bottom safe area insets, and also include the navigation bar height.
  //
  //   2. Storybook UI is not visible, and `noSafeArea` is false: Include top
  //      and bottom safe area insets.
  //
  //   3. Storybook UI is visible, and `noSafeArea` is true: Include only the
  //      bottom safe area inset and the navigation bar height.
  //
  //   4. Storybook UI is not visible, and `noSafeArea` is true: No margin.
  const safeAreaMargins: ViewStyle = {
    paddingBottom: isUIVisible ? insets.bottom + navBarHeight : noSafeArea ? 0 : insets.bottom,
    paddingTop: !noSafeArea ? insets.top : 0,
    overflow: 'hidden',
  };
  // The panels always apply the safe area, regardless of the story parameters.
  const panelSafeAreaMargins: ViewStyle = {
    paddingBottom: insets.bottom + navBarHeight,
    paddingTop: insets.top,
  };
  // Adjust the keyboard offset (possibly in a negative direction) to account
  // for the safe area and navigation bar.
  const keyboardVerticalOffset =
    -panelSafeAreaMargins.paddingBottom + (keyboardAvoidingViewVerticalOffset ?? 0);

  const [isSplitPanelVisible] = useIsSplitPanelVisible();
  const isPreviewInactive = tabOpen !== CANVAS;

  const selected: Selection = useMemo(
    () => story?.id && { storyId: story?.id, refId: DEFAULT_REF_ID },
    [story?.id]
  );

  const storyHash = useMemo(() => {
    return transformStoryIndexToStoriesHash(storyIndex, {
      docsOptions: { docsMode: false, autodocs: false, defaultName: '' },
      filters: {},
      status: {},
      provider: {
        handleAPI: () => ({}),
        getConfig: () => ({}),
      },
    });
  }, [storyIndex]);

  // const dataset = useCombination(
  //   storyHash,
  //   undefined,
  //   true,
  //   {}, // ???
  //   {} // ??
  // );

  // const isLoading = false; //!index && !indexError;
  // const lastViewedProps = useLastViewed(selected);

  return (
    <>
      <Container>
        <KeyboardAvoidingView
          enabled={!shouldDisableKeyboardAvoidingView || isPreviewInactive}
          behavior={IS_IOS ? 'padding' : null}
          keyboardVerticalOffset={keyboardVerticalOffset}
          style={flex}
        >
          <AbsolutePositionedKeyboardAwareView
            onLayout={setPreviewDimensions}
            previewDimensions={previewDimensions}
          >
            <Animated.View style={previewWrapperStyles}>
              <Preview style={safeAreaMargins} animatedValue={animatedValue.current}>
                <StoryView />
                {isSplitPanelVisible ? (
                  <Panel edge="top" style={{ flex: 1 }}>
                    <Addons active />
                    <AddonsSkeleton visible={isPreviewInactive} />
                  </Panel>
                ) : null}
              </Preview>
              {isPreviewInactive ? (
                <TouchableOpacity
                  style={StyleSheet.absoluteFillObject}
                  onPress={() => handleToggleTab(CANVAS)}
                />
              ) : null}
            </Animated.View>
            <Panel
              edge="right"
              style={[
                getSidebarPanelPosition(animatedValue.current, previewDimensions.width, wide),
                panelSafeAreaMargins,
              ]}
            >
              {/* <Provider >
              if we can get this provider working then we can user the use storybook hooks
                {(_combo) => {
                  return <SidebarContainer />;
                }}
              </Provider> */}
              {/* <Explorer
                  dataset={dataset}
                  selected={selected}
                  isLoading={isLoading}
                  isBrowsing={false}
                  setSelection={({ storyId }) => {
                    const channel = addons.getChannel();

                    channel.emit(SET_CURRENT_STORY, { storyId });
                  }}
                /> */}

              <Sidebar
                extra={[]}
                previewInitialized
                indexError={undefined}
                refs={{}}
                setSelection={({ storyId }) => {
                  const channel = addons.getChannel();

                  channel.emit(SET_CURRENT_STORY, { storyId });
                }}
                status={{}}
                index={storyHash}
                storyId={selected?.storyId}
                refId={DEFAULT_REF_ID}
              />

              {/* <StoryListView storyIndex={storyIndex} /> */}
            </Panel>

            <Panel
              edge="left"
              style={[
                getAddonPanelPosition(animatedValue.current, previewDimensions.width, wide),
                panelSafeAreaMargins,
              ]}
            >
              <Addons active={tabOpen === ADDONS} />
            </Panel>
          </AbsolutePositionedKeyboardAwareView>
        </KeyboardAvoidingView>
        <Navigation onLayout={measureNavigation} tabOpen={tabOpen} onChangeTab={handleToggleTab} />
      </Container>
    </>
  );
};
export default React.memo(OnDeviceUI);
