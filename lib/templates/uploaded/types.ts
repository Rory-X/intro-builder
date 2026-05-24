export type DecorationConfig = {
  bgImageUrl: string;
  placement: {
    position: "absolute";
    top: string;
    right: string;
    width: string;
    height: string;
    zIndex: number;
    opacity: number;
  };
  pageBgColor?: string;
};

// LayoutConfig + UploadedTemplate types added in Task 4
