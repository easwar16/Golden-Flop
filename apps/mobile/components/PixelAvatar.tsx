/**
 * PixelAvatar – renders a deterministic 5×5 pixel-art avatar from a seed.
 * Pure React Native, no additional dependencies.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { generateAvatar } from '@/utils/avatar-generator';

interface PixelAvatarProps {
  seed: string;
  size?: number;
  borderRadius?: number;
}

const PixelAvatar = memo(function PixelAvatar({
  seed,
  size = 72,
  borderRadius,
}: PixelAvatarProps) {
  const { grid, bg } = useMemo(() => generateAvatar(seed), [seed]);

  const cellSize = size / 5;
  const radius = borderRadius ?? size / 2;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
          overflow: 'hidden',
        },
      ]}>
      {grid.map((row, r) =>
        row.map((color, c) =>
          color ? (
            <View
              key={`${r}-${c}`}
              style={{
                position: 'absolute',
                left: c * cellSize,
                top: r * cellSize,
                width: cellSize,
                height: cellSize,
                backgroundColor: color,
              }}
            />
          ) : null
        )
      )}
    </View>
  );
});

export default PixelAvatar;

const styles = StyleSheet.create({
  container: { alignSelf: 'center'},
});
