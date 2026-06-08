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
          colorPrimary: '#2563eb',
          colorInfo: '#0369a1',
          colorSuccess: '#15803d',
          colorWarning: '#b45309',
          colorError: '#dc2626',
          colorBgLayout: '#f8fafc',
          colorBgContainer: '#ffffff',
          colorBgElevated: '#ffffff',
          colorBorder: '#d8e0ea',
          colorBorderSecondary: '#e5ebf2',
          colorText: '#172033',
          colorTextSecondary: '#64748b',
          colorTextTertiary: '#8794a8',
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
            headerBg: '#f8fafc',
            rowHoverBg: '#eff6ff',
          },
          Input: {
            activeBorderColor: '#2563eb',
            hoverBorderColor: '#93b4f8',
          },
          Select: {
            activeBorderColor: '#2563eb',
            hoverBorderColor: '#93b4f8',
          },
          Tabs: {
            inkBarColor: '#2563eb',
            itemSelectedColor: '#2563eb',
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
