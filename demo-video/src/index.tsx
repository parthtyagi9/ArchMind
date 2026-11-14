import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {ArchMindDemo} from './video';

registerRoot(() => <Composition id="ArchMindDemo" component={ArchMindDemo} durationInFrames={1800} fps={30} width={1920} height={1080} />);
