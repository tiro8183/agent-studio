import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './app/App';
import './styles.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0f6f62',
          colorInfo: '#495c8c',
          colorSuccess: '#15803d',
          colorWarning: '#a15c07',
          colorError: '#b42318',
          colorBgLayout: '#f3f4f1',
          colorBgContainer: '#fffefa',
          colorBgElevated: '#ffffff',
          colorBorder: '#d4d1c7',
          colorBorderSecondary: '#e7e2d8',
          colorText: '#171a16',
          colorTextSecondary: '#67685f',
          colorTextTertiary: '#85867c',
          borderRadius: 5,
          borderRadiusLG: 6,
          controlHeight: 34,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Button: {
            borderRadius: 5,
            controlHeight: 34,
            primaryShadow: 'none',
            defaultShadow: 'none',
          },
          Card: {
            borderRadiusLG: 6,
          },
          Table: {
            headerBg: '#f8f7f2',
            rowHoverBg: '#eef3ef',
          },
          Input: {
            activeBorderColor: '#0f6f62',
            hoverBorderColor: '#9fb8af',
          },
          Select: {
            activeBorderColor: '#0f6f62',
            hoverBorderColor: '#9fb8af',
          },
          Tabs: {
            inkBarColor: '#0f6f62',
            itemSelectedColor: '#0f6f62',
          },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
