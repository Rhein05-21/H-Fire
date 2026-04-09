import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const PROVIDER_GOOGLE = 'google';

export const Marker = () => null;

const MapView = React.forwardRef(({ style, children }: any, ref: any) => {
  React.useImperativeHandle(ref, () => ({
    animateToRegion: () => {
      console.log('animateToRegion is not supported on web');
    },
    animateCamera: () => {
      console.log('animateCamera is not supported on web');
    },
    fitToCoordinates: () => {
      console.log('fitToCoordinates is not supported on web');
    },
  }));

  return (
    <View style={[styles.placeholder, style]}>
      <Text style={styles.text}>Maps are not supported on web yet.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  text: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default MapView;
