import { join, dirname } from 'path';
// import * as ws from 'ws';
import { WebSocketServer } from 'ws';
import * as querystring from 'querystring';
import EVENTS from '@storybook/core-events';
import { Channel } from '@storybook/channels';
import { Options } from '@storybook/types';
import { StorybookConfig } from '@storybook/react-webpack5';
/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value) {
  return dirname(require.resolve(join(value, 'package.json')));
}

type ReactNativeServerOptions = {
  host?: string;
  port?: number;
};

/** @type { import('@storybook/react-webpack5').StorybookConfig } */
const config = {
  stories: ['../components/**/*.stories.?(ts|tsx|js|jsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-essentials'),
    getAbsolutePath('@storybook/addon-interactions'),
    getAbsolutePath('@storybook/addon-react-native-web'),
  ],

  framework: {
    name: '@storybook/react-webpack5',
    options: {
      builder: {
        useSWC: true,
      },
    },
  },

  // @ts-expect-error
  reactNativeServerOptions: {
    host: 'localhost',
    port: 7007,
  },

  webpackFinal: async (config, options) => {
    config.module.rules = config.module.rules.filter(
      // @ts-ignore
      (rule) => !rule?.use?.some?.((u) => String(u?.loader)?.includes?.('export-order-loader'))
    );
    return config;
  },

  experimental_serverChannel: async (channel: Channel, { configType, presets }: Options) => {
    if (configType === 'DEVELOPMENT') {
      const options = await presets.apply<ReactNativeServerOptions>('reactNativeServerOptions');

      if (options) {
        const port = options.port ?? 7007;

        const host = options.host ?? 'localhost';

        const wss = new WebSocketServer({ port, host });

        wss.on('connection', function connection(ws) {
          console.log('websocket connection');

          ws.on('error', console.error);

          ws.on('message', function message(data) {
            try {
              const json = JSON.parse(data.toString());

              if (json.args.length > 0) {
                channel.emit(json.type, json.args[0]);
              } else {
                channel.emit(json.type);
              }
            } catch (error) {
              console.error(error);
            }
          });

          // ws.on('message', (data) => {
          //   console.log('recieved from upstream channel:', data);

          //   wss.clients.forEach((c) => {
          //     c.send(data);
          //   });
          // });

          // ws.send('something');
        });

        [
          ...Object.values(EVENTS),
          'storybook-addon-background:set',
          'storybook-addon-background:unset',
          'storybook-addon-background:update',
          'storybook/actions/action-event',
          'storybook/actions/action-clear',
        ].forEach((curEvent) => {
          channel.on(curEvent, async (data) => {
            try {
              if (curEvent === 'storybook/actions/action-event' && data?.data?.args?.target) {
                // fixes self referencing object error for json stringify
                data.data.args.nativeEvent = null;
                data.data.args.target = null;
                data.data.args.currentTarget = null;
                data.data.args.view = null;
              }

              const toSend = JSON.stringify({ type: curEvent, args: [data] });

              wss.clients.forEach((ws) => ws.send(toSend));
            } catch (error) {
              console.error({ event: curEvent, error });
            }
          });
        });
      }
    }

    return channel;
  },

  docs: {
    autodocs: 'tag',
  },
} satisfies StorybookConfig;

export default config;
