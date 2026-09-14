#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ScreenProtection, RCTEventEmitter)
RCT_EXTERN_METHOD(enable)
RCT_EXTERN_METHOD(disable)
@end
