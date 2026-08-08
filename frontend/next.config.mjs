/** @type {import('next').NextConfig} */
const apiHost = process.env.API_INTERNAL_URL || 'http://api-service:4000';

const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/movies/:path*',
        destination: `${apiHost}/movies/:path*`,
      },
      {
        source: '/movies',
        destination: `${apiHost}/movies`,
      },
      {
        source: '/showtimes/:path*',
        destination: `${apiHost}/showtimes/:path*`,
      },
      {
        source: '/bookings/:path*',
        destination: `${apiHost}/bookings/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${apiHost}/auth/:path*`,
      },
      {
        source: '/health',
        destination: `${apiHost}/health`,
      },
    ];
  },
};

export default nextConfig;
