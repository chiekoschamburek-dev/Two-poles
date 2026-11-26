/** 真人演示素材对应 data_demo/selected/manifest.json；路径从 public/demo-videos 本地加载。 */
export interface DemoVideo {
  file: string
  source: string
  note: string
}

const pexels = (id: number, file: string, note: string): DemoVideo => ({
  file,
  source: `https://www.pexels.com/video/${id}/`,
  note
})

export const demoVideos: Record<string, DemoVideo> = {
  '坐站训练': pexels(3196293, 'sit-to-stand.mp4', '椅子坐站：双脚踩稳，起身后再缓慢坐下'),
  '肩环绕': pexels(5510091, 'shoulder-circles.mp4', '手臂轻缓绕环，避免耸肩'),
  '髋部摆动': pexels(5510143, 'hip-sway.mp4', '站稳后让髋部轻缓摆动'),
  '高抬腿走': pexels(5025964, 'high-knee.mp4', '交替抬膝，保持躯干稳定'),
  '站姿弯举': pexels(6547801, 'dumbbell-curl.mp4', '上臂贴近身体，缓慢屈肘'),
  '弹力带弯举': pexels(6326763, 'band-curl.mp4', '踩稳弹力带，保持上臂稳定'),
  '水瓶替代弯举': pexels(6547801, 'dumbbell-curl.mp4', '画面使用哑铃示范同一弯举动作；跟练时改握水瓶'),
  '弹力带划船': pexels(8436003, 'band-row.mp4', '双肩下沉，向身侧拉回弹力带'),
  '台阶上下': pexels(4259066, 'step-up.mp4', '一脚踩稳台阶，再平稳上步'),
  '提踵': {
    file: 'calf-raise.webm',
    source: 'https://commons.wikimedia.org/wiki/File:Muscle_Strengthening_at_Home_-_Toe_Lift.webm',
    note: '扶稳支撑物，脚跟缓慢抬起再落下'
  },
  '平板支撑': pexels(6023273, 'forearm-plank.mp4', '前臂撑地，肩、髋、踝保持一线'),
  '大腿后侧拉伸': pexels(4457717, 'hamstring-stretch.mp4', '缓慢伸直腿，感受大腿后侧拉伸'),
  '腹式呼吸放松': {
    file: 'belly-breathing.webm',
    source: 'https://commons.wikimedia.org/wiki/File:Abdominal_breathing.webm',
    note: '观察腹部随呼吸轻缓起伏'
  },
  '快走': pexels(6548034, 'brisk-walk.mp4', '自然摆臂，保持能交谈的步速'),
  '轻松跑': pexels(7597229, 'easy-run.mp4', '放松肩膀，轻松慢跑')
}
